// Baixa de pagamento na Vobi (ESCRITA) + consulta de vencimentos.
//
// Usado pelo bot @cjr_adm_bot no grupo financeiro: a pessoa manda o comprovante
// (ou digita valor + fornecedor), escolhe a qual vencimento se refere, e o bot
// dá a baixa na Vobi lançando juros/multa quando o valor pago é maior que o
// original (a Adriana costuma pagar em atraso).
//
// Endpoint confirmado no spec oficial (v2): PUT /v2/installment/{id}
//   idInstallmentStatus: 4 = "Pago manualmente" (2 = Pago; 2..11 contam como pago)
//   paidDate  = data do pagamento efetivo
//   price     = valor FINAL pago (com juros/multa/desconto aplicados)
//   interest / fine / discount = juros, multa e desconto
//   idPaymentBankAccount / idPaymentType = de onde saiu e como pagou
//
// REGRA DE OURO: a Vobi tem bug conhecido de PUT que responde 200 SEM persistir
// (ver vobiEscrita.ts). Toda baixa aqui RELÊ a parcela depois e só reporta
// sucesso se o status realmente virou pago. Nunca dizer "pago" sem conferir.

import { supabaseAdmin } from "./supabase";

const VOBI = "https://api.vobi.com.br/v2";

function creds() {
  // import.meta.env so existe sob o Vite; fora dele (script, cron por node) e
  // undefined e o acesso direto quebra.
  const meta = (import.meta as any)?.env ?? {};
  const uuid = process.env.VOBI_UUID ?? meta.VOBI_UUID;
  const secret = process.env.VOBI_SECRET ?? meta.VOBI_SECRET;
  return { uuid, secret };
}

export function vobiBaixaConfigurada(): boolean {
  const { uuid, secret } = creds();
  return !!(uuid && secret);
}

// Token da Vobi dura ~5 min; cache de 4 min por instância.
let _token: string | null = null;
let _tokenAt = 0;
async function token(): Promise<string> {
  if (_token && Date.now() - _tokenAt < 4 * 60 * 1000) return _token;
  const { uuid, secret } = creds();
  if (!uuid || !secret) throw new Error("Credenciais da Vobi (VOBI_UUID/VOBI_SECRET) não configuradas.");
  const basic = Buffer.from(`${uuid}:${secret}`).toString("base64");
  const r = await fetch(`${VOBI}/auth/token`, { method: "POST", headers: { authorization: `Basic ${basic}` } });
  if (!r.ok) throw new Error(`Autenticação na Vobi falhou (HTTP ${r.status}).`);
  const j: any = await r.json();
  _token = j.jwt || j.token;
  _tokenAt = Date.now();
  if (!_token) throw new Error("Token da Vobi não retornado.");
  return _token;
}

/**
 * Erro de cota da Vobi. A API libera 1000 requisições por hora
 * (`ratelimit-policy: 1000;w=3600`) para a integração INTEIRA — bot, telas
 * /admin/vobi-*, lembretes e o Excel financeiro diário (~600 num run às 07:00).
 * Quando estoura, não adianta repetir na hora: a janela é de até 1h.
 */
export class VobiCotaError extends Error {
  readonly cota = true;
  /** segundos até a cota voltar, quando a Vobi informa */
  readonly esperaSeg: number | null;
  constructor(esperaSeg: number | null) {
    super(
      "A Vobi bloqueou temporariamente as consultas (cota de 1000 por hora)." +
        (esperaSeg ? ` Ela volta em ~${Math.ceil(esperaSeg / 60)} min.` : ""),
    );
    this.esperaSeg = esperaSeg;
  }
}

/** Lê quanto falta para a cota voltar: `retry-after` ou o `reset=` do `ratelimit`. */
function esperaDoHeader(h: Headers): number | null {
  const ra = Number(h.get("retry-after"));
  if (Number.isFinite(ra) && ra > 0) return ra;
  const m = /reset=(\d+)/.exec(h.get("ratelimit") || "");
  return m ? Number(m[1]) : null;
}

async function vGet(path: string): Promise<any> {
  const r = await fetch(`${VOBI}${path}`, { headers: { authorization: `Bearer ${await token()}` } });
  if (r.status === 429) throw new VobiCotaError(esperaDoHeader(r.headers));
  if (!r.ok) throw new Error(`Vobi GET ${path}: HTTP ${r.status}`);
  return r.json();
}

async function vPost(path: string, body: any): Promise<any> {
  const r = await fetch(`${VOBI}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (r.status === 429) throw new VobiCotaError(esperaDoHeader(r.headers));
  if (!r.ok) throw new Error(`Vobi POST ${path}: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
  return r.json().catch(() => ({}));
}

async function vPut(path: string, body: any): Promise<any> {
  const r = await fetch(`${VOBI}${path}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (r.status === 429) throw new VobiCotaError(esperaDoHeader(r.headers));
  if (!r.ok) throw new Error(`Vobi PUT ${path}: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
  return r.json().catch(() => ({}));
}

/**
 * Pagina um endpoint de listagem da Vobi.
 *
 * DUAS ARMADILHAS da API (medidas em 16/09/2026, não remover as defesas):
 *
 * 1) PAGINAR SEM `order` DUPLICA E PERDE LINHAS. Varrendo as 1.335 parcelas em
 *    aberto sem ordenação vieram 1.335 linhas mas só 1.184 ids únicos — ~150
 *    parcelas NUNCA apareciam. Com `order[0][0]=id&order[0][1]=ASC`: 1.335/1.335.
 *    Por isso a ordenação é obrigatória aqui, e ainda deduplicamos por id.
 *
 * 2) O `count` da resposta espelha o `limit`, não o total — nunca use para contar.
 */
async function vGetAll(endpoint: string, extra = "", maxPaginas = 40, campoOrdem = "id"): Promise<any[]> {
  const out: any[] = [];
  const vistos = new Set<string>();
  const ordem = `&order[0][0]=${campoOrdem}&order[0][1]=ASC`;
  for (let p = 0; p < maxPaginas; p++) {
    const j = await vGet(`/${endpoint}?limit=500&offset=${p * 500}${ordem}${extra}`);
    const rows = j?.rows || j?.data || (Array.isArray(j) ? j : []);
    for (const r of rows) {
      const k = String(r?.id ?? "");
      if (k && vistos.has(k)) continue;
      if (k) vistos.add(k);
      out.push(r);
    }
    if (rows.length < 500) break;
  }
  return out;
}

// ─────────────────────────────── catálogos ───────────────────────────────

/** Contas e formas mais usadas pela CJR (medido no histórico 2026: Santander
 *  concentra 81% das baixas; PIX e Boleto dominam as formas). O bot mostra
 *  estas primeiro e deixa "outra" para o resto. */
export const CONTAS_PRINCIPAIS = [
  { id: 24582, nome: "Santander Empresa" },
  { id: 24624, nome: "Cartão 1405 Nubank" },
  { id: 24986, nome: "BAIXA_VOBI" },
  { id: 30168, nome: "Banco Villela" },
  { id: 24607, nome: "Bradesco Empresa" },
  { id: 24608, nome: "Sicoob Empresa" },
];

/**
 * Contas ATIVAS que podem ser ponta de uma transferencia — conferidas contra
 * /bank-account em 17/09/2026. Ficam de fora os cartoes de credito (pedido da
 * Adriana: transferencia nao sai de cartao), o BAIXA_VOBI e o EMPRESTIMOS, que
 * sao contas de ajuste e nao banco de verdade.
 *
 * O `rx` serve para MARCAR com uma estrela o banco que o comprovante mencionou —
 * a pessoa ainda escolhe. Caixa Pessoal fica sem `rx` de proposito: divide o nome
 * com a Caixa Empresa, e palpite errado atrapalha mais do que ajuda.
 */
export const CONTAS_TRANSFERENCIA: Array<{ id: number; nome: string; rx?: RegExp }> = [
  { id: 30168, nome: "Banco Villela", rx: /vil?lela/i },
  { id: 24582, nome: "Santander", rx: /santander/i },
  { id: 24596, nome: "Banco do Brasil", rx: /banco do brasil/i },
  { id: 24609, nome: "Itaú", rx: /ita(u|ú)/i },
  { id: 24607, nome: "Bradesco", rx: /bradesco/i },
  { id: 24608, nome: "Sicoob", rx: /sicoob/i },
  { id: 24610, nome: "Caixa Empresa", rx: /caixa econ[oô]mica|caixa federal|\bcef\b/i },
  { id: 24611, nome: "Nubank", rx: /nubank|nu pagamentos/i },
  { id: 24613, nome: "Caixa Pessoal" },
  { id: 24668, nome: "Vobi Pay", rx: /vobi\s*pay/i },
];

/** Qual conta o comprovante sugere, pelo texto do banco. null se nao der para dizer. */
export function contaPorTexto(texto?: string | null): number | null {
  const t = String(texto || "").trim();
  if (t.length < 3) return null;
  for (const c of CONTAS_TRANSFERENCIA) if (c.rx && c.rx.test(t)) return c.id;
  return null;
}

export const nomeDaConta = (id?: number | null) =>
  CONTAS_TRANSFERENCIA.find((c) => c.id === id)?.nome ||
  CONTAS_PRINCIPAIS.find((c) => c.id === id)?.nome ||
  `conta ${id}`;

/** Campos que a Vobi CALCULA — reenviar num PUT faz o payload ser recusado. */
const CAMPOS_CALCULADOS = [
  "id", "createdAt", "updatedAt", "deletedAt", "installments", "total", "liquidTotal",
  "paidValue", "paidSplitValue", "cancelledValue", "openAmount", "openSplitAmount",
  "totalIsValid", "allDueDateDiscount", "allSplitDueDateDiscount", "allInterest",
  "allSplitInterest", "suggestionData", "countFile", "viewedBy", "createdBy", "isSplit",
  "splitId", "splitQuantity", "percentageSplitValue", "totalSplitValue", "isMainSplit",
  "transferId", "transferType", "paymentItems", "files",
];

// Constantes da transferencia entre contas proprias, conferidas na Vobi em
// 17/09/2026 ao lancar a quitacao da tarifa do Banco do Brasil.
const CAT_TRANSF_SAIDA = 22896755;   // Transferência entre Contas (despesa)
const CAT_TRANSF_ENTRADA = 22957008; // Transferência entre Contas (receita)
const CC_TRANSF = 26522;             // centro de custo TRANSFERENCIA ENTRE CONTAS
const FORN_CJR = 665913;             // COSTA JUNIOR ENGENHARIA E CONS. LTDA (fornecedor)
// A própria empresa no cadastro de CLIENTES. Há seis registros parecidos na base
// (incluindo o sócio JOSE FERREIRA DA COSTA JUNIOR, que NÃO é a empresa); este é
// o da pessoa jurídica. Se a Adriana consolidar os duplicados, trocar aqui.
const CLIENTE_CJR = 235768;          // COSTA JUNIOR ENGENHARIA E CONSTRUCOES
const ID_EMPRESA = 96840;
const ID_ENTIDADE = "04afa8bd-6159-44d0-95e4-e23bda31c8ae";

/**
 * Grava uma transferencia entre contas da propria empresa: a SAIDA na conta de
 * origem e a ENTRADA na de destino. Sao dois lancamentos — a Vobi nao tem
 * endpoint que faca os dois de uma vez.
 *
 * Cuidados que vieram de erro real ao lancar isto na mao:
 *  - sem idCompany/idCompanyEntity o POST responde 400 "Empresa nao informada";
 *  - o POST as vezes cria o pagamento SEM as parcelas, e ai e preciso um PUT com
 *    os campos de recorrencia zerados (senao volta 400 falando de idPaymentType,
 *    mensagem que nao tem nada a ver com a causa);
 *  - a Vobi ja respondeu 200 sem gravar, entao conferimos a parcela antes de
 *    dizer que deu certo;
 *  - se a saida gravar e a entrada falhar, devolvemos o id da saida. Meia
 *    transferencia e pior que nenhuma: o dinheiro some do caixa.
 */
export async function criarTransferenciaEntreContas(opcoes: {
  origem: number; destino: number; valor: number; data: string; autor?: string;
  /**
   * Retomada de meia transferência: a saída já foi gravada numa tentativa
   * anterior e só falta a entrada. Sem isto, tentar de novo gravaria a saída
   * PELA SEGUNDA VEZ e o dinheiro sairia duas vezes da conta de origem.
   */
  idSaidaExistente?: string;
}): Promise<{ ok: boolean; idSaida?: string; idEntrada?: string; erro?: string }> {
  const { origem, destino, valor, data } = opcoes;

  // Guardas de sanidade ANTES de escrever. O botão já impede escolher a mesma
  // conta dos dois lados, mas quem garante o livro é o servidor, não a tela.
  if (!(valor > 0)) return { ok: false, erro: "valor inválido para uma transferência" };
  if (origem === destino) return { ok: false, erro: "origem e destino são a mesma conta" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return { ok: false, erro: `data inválida: ${data}` };

  const nome = `${nomeDaConta(origem)} - ${nomeDaConta(destino)}`.toUpperCase();
  const nota =
    `Transferencia entre contas da propria empresa: ${nomeDaConta(origem)} -> ${nomeDaConta(destino)}, ` +
    `${valor.toFixed(2)} em ${data}. Lancada pelo comprovante enviado no Telegram` +
    `${opcoes.autor ? " por " + opcoes.autor : ""}.`;

  const criar = async (conta: number, billType: string, cat: number) => {
    const parcela = {
      price: valor, percentage: 100, number: 1, dueDate: data,
      idInstallmentStatus: 2, paidDate: data, paidValue: valor,
      idPaymentBankAccount: conta, idPaymentType: 5, description: nome,
    };
    const corpo: any = {
      name: nome, billType, value: valor, subTotal: valor, billingDate: data,
      idPaymentBankAccount: conta, idFinancialCategory: cat, idPaymentCostCenter: CC_TRANSF,
      ownBusiness: true, idCompany: ID_EMPRESA, idCompanyEntity: ID_ENTIDADE, idPaymentStatus: 3,
      annotation: nota, isRecurrence: false, recurrenceId: null, interval: 0,
      frequency: null, lastRecurrenceDate: null, installments: [parcela],
    };
    // Regra da casa: fornecedor/cliente nunca fica em branco. Numa transferência
    // entre contas próprias, os dois lados são a própria empresa — a despesa usa
    // a CJR como fornecedor e a receita usa a CJR como cliente.
    if (billType === "expense") corpo.idSupplier = FORN_CJR;
    else corpo.idCompanyCustomer = CLIENTE_CJR;

    const criado = await vPost("/payment", corpo);
    const id = criado?.id;
    if (!id) throw new Error("a Vobi nao devolveu o id do lancamento");

    const parcelasDo = async () =>
      ((await vGet(`/installment?limit=20&where[idPayment]=${id}`))?.rows || [])
        .filter((i: any) => i.idPayment === id);
    let ps = await parcelasDo();
    if (!ps.length) {
      const atual: any = { ...(await vGet(`/payment/${id}`)) };
      for (const k of CAMPOS_CALCULADOS) delete atual[k];
      atual.installments = [parcela];
      atual.isRecurrence = false; atual.recurrenceId = null;
      atual.interval = 0; atual.frequency = null; atual.lastRecurrenceDate = null;
      await vPut(`/payment/${id}`, atual);
      ps = await parcelasDo();
    }

    const p = ps[0];
    const bom = ps.length === 1 && p && Math.abs(num(p.price) - valor) < 0.01 &&
      p.idPaymentBankAccount === conta && p.idInstallmentStatus === 2;
    // O id vai JUNTO no erro: sem ele, um lançamento meio-criado fica na Vobi
    // sem ninguém saber o que procurar para apagar.
    if (!bom) throw new Error(`a parcela nao ficou como devia (${ps.length} parcela(s)) — lancamento ${id}`);
    return id as string;
  };

  let idSaida = opcoes.idSaidaExistente;
  try {
    if (!idSaida) idSaida = await criar(origem, "expense", CAT_TRANSF_SAIDA);
    const idEntrada = await criar(destino, "income", CAT_TRANSF_ENTRADA);
    return { ok: true, idSaida, idEntrada };
  } catch (e: any) {
    return { ok: false, idSaida, erro: String(e?.message || e) };
  }
}


export const FORMAS_PAGAMENTO = [
  { id: 1, nome: "PIX" },
  { id: 2, nome: "Boleto" },
  { id: 9, nome: "Débito em conta" },
  { id: 5, nome: "Transferência" },
  { id: 3, nome: "Cartão de crédito" },
  { id: 6, nome: "Dinheiro" },
];

export const CONTA_PADRAO = 24582; // Santander Empresa
export const FORMA_PADRAO = 1; // PIX

/**
 * Cartões de crédito EM USO na CJR. Quando a conta é paga por aqui ela NÃO é
 * baixada: o vencimento é empurrado para a fatura (ver rolarParaCartao).
 *
 * Só o Nubank está ativo (decisão da Adriana, 16/09/2026) — os demais cartões
 * existem na Vobi mas não são usados, então ficam fora do bot para não poluir.
 * Com um único cartão, o bot nem pergunta qual é: vai direto para os juros.
 */
export const CARTOES = [
  { id: 24624, nome: "Nubank 1405" },
];

export const FORMA_CARTAO = 3; // Cartão de crédito
export const DIA_VENCIMENTO_FATURA = 2; // as faturas da CJR vencem dia 02

/**
 * Próximo vencimento da fatura do cartão: dia 02 do mês SEGUINTE ao de hoje
 * (regra da Adriana, 16/09/2026). Ex.: pagou em 16/09 → a fatura vence 02/10.
 */
export function proximoVencimentoCartao(hoje?: string): string {
  const base = hoje ? new Date(hoje + "T12:00:00Z") : new Date(Date.now() - 3 * 60 * 60 * 1000);
  const ano = base.getUTCFullYear();
  const mes = base.getUTCMonth() + 1; // 0-based -> mês seguinte
  const d = new Date(Date.UTC(ano, mes, DIA_VENCIMENTO_FATURA));
  return d.toISOString().slice(0, 10);
}

let _contasCache: { at: number; dados: Record<number, string> } | null = null;
export async function contasBancarias(): Promise<Record<number, string>> {
  if (_contasCache && Date.now() - _contasCache.at < 30 * 60 * 1000) return _contasCache.dados;
  const j = await vGet("/bank-account?limit=100");
  const dados: Record<number, string> = {};
  for (const b of j?.rows || []) dados[b.id] = b.name;
  _contasCache = { at: Date.now(), dados };
  return dados;
}

// ───────────────────────────── clientes ─────────────────────────────
//
// Espelha o cache de fornecedores, mas e MUITO mais barato: sao 465 clientes
// numa unica pagina (contra 2.540 fornecedores em 6). O endpoint e
// /company-customer e o campo na parcela e payment.idCompanyCustomer.

export type Cliente = { id: number; nome: string; razao: string };

let _cliCache: { at: number; lista: Cliente[] } | null = null;
const CHAVE_CLI = "clientes";

async function clientesSalvos(): Promise<{ lista: Cliente[]; at: number } | null> {
  try {
    const { data } = await supabaseAdmin()
      .from("vobi_cache").select("dados, atualizado_em").eq("chave", CHAVE_CLI).maybeSingle();
    const lista = data?.dados as Cliente[] | undefined;
    if (!Array.isArray(lista) || !lista.length) return null;
    return { lista, at: new Date(data!.atualizado_em).getTime() };
  } catch { return null; }
}

/** Lista de clientes, em cache: memória (1h) → banco (24h) → Vobi (1 requisição). */
export async function clientes(): Promise<Cliente[]> {
  if (_cliCache && Date.now() - _cliCache.at < FORN_TTL_MEM) return _cliCache.lista;

  const salvo = await clientesSalvos();
  if (salvo && Date.now() - salvo.at < FORN_TTL_DB) {
    _cliCache = { at: Date.now(), lista: salvo.lista };
    return salvo.lista;
  }

  let rows: any[];
  try {
    rows = await vGetAll("company-customer", "", 3);
  } catch (e) {
    if (salvo) { _cliCache = { at: Date.now(), lista: salvo.lista }; return salvo.lista; }
    throw e;
  }

  const lista = rows
    .map((c: any) => ({
      id: c.id,
      nome: String(c.name || c.legalName || "").trim(),
      razao: String(c.legalName || "").trim(),
    }))
    .filter((c) => c.id && (c.nome || c.razao));
  if (!lista.length && salvo) return salvo.lista;

  _cliCache = { at: Date.now(), lista };
  try {
    await supabaseAdmin().from("vobi_cache").upsert(
      { chave: CHAVE_CLI, dados: lista, atualizado_em: new Date().toISOString() },
      { onConflict: "chave" },
    );
  } catch { /* cache é otimização; sem a tabela, só não persiste */ }
  return lista;
}

/** Mapa id -> nome, só para os clientes que aparecem nestas linhas. */
async function mapaClientes(linhas: any[]): Promise<Record<number, string>> {
  const ids = new Set<number>();
  for (const i of linhas) { const c = Number((i.payment || {}).idCompanyCustomer); if (c) ids.add(c); }
  if (!ids.size) return {};
  const lista = await clientes().catch(() => [] as Cliente[]);
  const mapa: Record<number, string> = {};
  for (const c of lista) if (ids.has(c.id)) mapa[c.id] = c.nome || c.razao;
  return mapa;
}

// ──────────────────────────── fornecedores ────────────────────────────

export type Fornecedor = { id: number; nome: string; razao: string };

let _fornCache: { at: number; lista: Fornecedor[] } | null = null;

const CHAVE_FORN = "fornecedores";
const FORN_TTL_MEM = 60 * 60 * 1000; // 1h na memória da instância
const FORN_TTL_DB = 24 * 60 * 60 * 1000; // 24h no banco antes de buscar de novo

/** Lê a cópia salva no banco. Nunca lança: sem tabela/sem banco, só não tem cache. */
async function fornecedoresSalvos(): Promise<{ lista: Fornecedor[]; at: number } | null> {
  try {
    const { data } = await supabaseAdmin()
      .from("vobi_cache").select("dados, atualizado_em").eq("chave", CHAVE_FORN).maybeSingle();
    const lista = data?.dados as Fornecedor[] | undefined;
    if (!Array.isArray(lista) || !lista.length) return null;
    return { lista, at: new Date(data!.atualizado_em).getTime() };
  } catch { return null; }
}

async function salvarFornecedores(lista: Fornecedor[]): Promise<void> {
  try {
    await supabaseAdmin().from("vobi_cache").upsert(
      { chave: CHAVE_FORN, dados: lista, atualizado_em: new Date().toISOString() },
      { onConflict: "chave" },
    );
  } catch { /* cache é otimização, nunca pode derrubar a baixa */ }
}

/**
 * Lista de fornecedores (~2.540), em cache de 3 camadas: memória → banco → Vobi.
 *
 * Por que baixar tudo: a API da Vobi NÃO tem busca por texto — operadores como
 * [$iLike] devolvem 400 e `where[name]` exige o nome EXATO. Então a busca por
 * pedaço do nome é feita aqui, em memória (6 chamadas, ~1,5s).
 *
 * POR QUE O CACHE NO BANCO (17/09/2026): a cota da Vobi é de 1000 req/h para a
 * integração inteira, e na Vercel cada cold start zera o cache de memória — ou
 * seja, quase toda baixa de pagamento rebaixava as 6 páginas. Estourou a cota e
 * o bot devolveu "HTTP 429" no meio de um comprovante que já tinha lido certo.
 * Agora a lista sobrevive entre invocações e, se a Vobi recusar, usamos a última
 * cópia salva (mesmo velha) — nome de fornecedor quase não muda, e uma lista de
 * ontem é infinitamente melhor que um erro.
 *
 * NÃO filtrar por isActive: o LEROY MERLIN que concentra 152 parcelas em aberto
 * está cadastrado como isActive=false.
 */
export async function fornecedores(): Promise<Fornecedor[]> {
  if (_fornCache && Date.now() - _fornCache.at < FORN_TTL_MEM) return _fornCache.lista;

  const salvo = await fornecedoresSalvos();
  if (salvo && Date.now() - salvo.at < FORN_TTL_DB) {
    _fornCache = { at: Date.now(), lista: salvo.lista };
    return salvo.lista;
  }

  let rows: any[];
  try {
    rows = await vGetAll("supplier");
  } catch (e) {
    // Vobi fora do ar ou cota estourada: a cópia velha salva o lançamento.
    if (salvo) {
      _fornCache = { at: Date.now(), lista: salvo.lista };
      return salvo.lista;
    }
    throw e;
  }

  const lista = rows
    .map((f: any) => ({
      id: f.id,
      nome: String(f.name || f.companyName || f.fantasyName || "").trim(),
      razao: String(f.legalName || "").trim(),
    }))
    .filter((f) => f.id && (f.nome || f.razao));

  // lista vazia = resposta estranha da Vobi; não vale sobrescrever o cache bom
  if (!lista.length && salvo) return salvo.lista;

  _fornCache = { at: Date.now(), lista };
  await salvarFornecedores(lista);
  return lista;
}

function normalizar(s: string): string {
  return String(s || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Busca fornecedores por pedaço do nome. Procura no nome E na razão social —
 * há fornecedores cadastrados com nome de pessoa e a empresa só no legalName
 * (ex.: 3 "leroy" estão assim). Ordena os que COMEÇAM com o termo primeiro.
 */
export async function buscarFornecedores(termo: string, limite = 8): Promise<Fornecedor[]> {
  const t = normalizar(termo);
  if (t.length < 2) return [];
  const lista = await fornecedores();
  const achados = lista.filter((f) => normalizar(f.nome).includes(t) || normalizar(f.razao).includes(t));

  const ranque = (f: Fornecedor) => {
    const n = normalizar(f.nome);
    if (n === t) return 0;
    if (n.startsWith(t)) return 1;
    if (normalizar(f.razao).startsWith(t)) return 2;
    return 3;
  };
  achados.sort((a, b) => ranque(a) - ranque(b) || a.nome.length - b.nome.length);
  return achados.slice(0, limite);
}

/**
 * Palavras que aparecem em meio mundo de fornecedor e não identificam ninguém.
 * Sem esta lista, "MATERIAL DE CONSTRUÇÃO" casaria com qualquer coisa.
 */
const PALAVRAS_VAZIAS = new Set([
  "ltda", "me", "epp", "eireli", "sa", "cia", "comercio", "comercial",
  "industria", "industrial", "servicos", "servico", "material", "materiais",
  "construcao", "construcoes", "distribuidora", "distribuicao", "empresa",
  "grupo", "do", "da", "de", "dos", "das", "e", "em", "para", "por", "com",
]);

function palavrasDoTermo(termo: string): string[] {
  return normalizar(termo)
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length >= 3 && !PALAVRAS_VAZIAS.has(p));
}

/** Levenshtein com corte — só para perdoar erro de digitação do cadastro. */
function distancia(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let linha = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let ant = linha[0];
    linha[0] = i;
    let melhor = linha[0];
    for (let j = 1; j <= b.length; j++) {
      const tmp = linha[j];
      linha[j] = Math.min(linha[j] + 1, linha[j - 1] + 1, ant + (a[i - 1] === b[j - 1] ? 0 : 1));
      ant = tmp;
      if (linha[j] < melhor) melhor = linha[j];
    }
    if (melhor > max) return max + 1;
  }
  return linha[b.length];
}

/**
 * Quanto este fornecedor "parece" com o termo procurado. 0 = não parece nada.
 *
 * Pontua por PALAVRA, não por prefixo. O prefixo de 4 letras que existia aqui
 * antes era desastroso: "CONSTRUTIVO BPO" virava "cons" e casava com 144
 * fornecedores (construção, consultoria, consórcio…), devolvendo 6 aleatórios
 * — foi assim que um pagamento do CONSTRUTIVO CONTÁBIL foi parar no OBRAMAX.
 */
function pontuarFornecedor(f: Fornecedor, termoTodo: string, palavras: string[]): number {
  return pontuarNome(`${f.nome} ${f.razao}`, termoTodo, palavras);
}

/** O mesmo criterio, sobre um nome solto — serve p/ centro de custo e categoria. */
function pontuarNome(cru: string, termoTodo: string, palavras: string[]): number {
  const alvo = normalizar(cru);
  if (!alvo) return 0;
  const palavrasAlvo = alvo.split(/[^a-z0-9]+/).filter(Boolean);
  let pontos = 0;
  if (termoTodo.length >= 3 && alvo.includes(termoTodo)) pontos += 100;
  for (const p of palavras) {
    if (palavrasAlvo.includes(p)) pontos += p.length * 5 + 15;        // palavra inteira
    else if (alvo.includes(p)) pontos += p.length * 4;                 // pedaço de palavra
    else if (p.length >= 5 && palavrasAlvo.some((a) => a.length >= 5 && distancia(p, a) <= 2))
      pontos += p.length * 2;                                          // erro de digitação
  }
  return pontos;
}

/** Abaixo disto é coincidência de letras, não fornecedor parecido. */
const PONTOS_MINIMOS = 20;

/**
 * Busca tolerante: usada quando a busca literal não acha nada — seja porque o
 * comprovante traz um apelido ("CONSTRUTIVO BPO" para CONSTRUTIVO CONTÁBIL),
 * seja porque o cadastro da Vobi tem erro de digitação ("D4SING" / "D4SIGN").
 * Devolve ordenado pelo quanto casa, e NADA quando nada casa de verdade.
 */
export async function buscarFornecedoresAproximado(termo: string, limite = 6): Promise<Fornecedor[]> {
  const exatos = await buscarFornecedores(termo, limite);
  if (exatos.length) return exatos;

  const termoTodo = normalizar(termo);
  const palavras = palavrasDoTermo(termo);
  if (!palavras.length) return [];

  return (await fornecedores())
    .map((f) => ({ f, pontos: pontuarFornecedor(f, termoTodo, palavras) }))
    .filter((x) => x.pontos >= PONTOS_MINIMOS)
    .sort((a, b) => b.pontos - a.pontos || a.f.nome.length - b.f.nome.length)
    .slice(0, limite)
    .map((x) => x.f);
}

// ═══════════════════ NOVO LANÇAMENTO (cadastrar do zero) ═══════════════════
//
// Até aqui o bot só dava BAIXA em conta que já existia na Vobi. A Adriana pediu
// (23/09/2026) para também CADASTRAR: manda o comprovante com a legenda
// "Lançar - Chip Vivo - Cartão de crédito Nubank - CC Operação" e o lançamento
// nasce na Vobi. Compra no cartão quase nunca está lançada antes.

export type ItemCatalogo = { id: number; nome: string };

const _catMem = new Map<string, { at: number; lista: ItemCatalogo[] }>();

/**
 * Catálogo da Vobi em cache de 3 camadas (memória 1h → vobi_cache 24h → API),
 * igual aos fornecedores e pelo mesmo motivo: a cota é de 1000 req/h para a
 * integração inteira e cada cold start da Vercel zera a memória.
 */
async function catalogo(chave: string, endpoint: string): Promise<ItemCatalogo[]> {
  const mem = _catMem.get(chave);
  if (mem && Date.now() - mem.at < FORN_TTL_MEM) return mem.lista;

  let salvo: { lista: ItemCatalogo[]; at: number } | null = null;
  try {
    const { data } = await supabaseAdmin()
      .from("vobi_cache").select("dados, atualizado_em").eq("chave", chave).maybeSingle();
    const l = data?.dados as ItemCatalogo[] | undefined;
    if (Array.isArray(l) && l.length) salvo = { lista: l, at: new Date(data!.atualizado_em).getTime() };
  } catch { /* sem cache é só mais lento */ }

  if (salvo && Date.now() - salvo.at < FORN_TTL_DB) {
    _catMem.set(chave, { at: Date.now(), lista: salvo.lista });
    return salvo.lista;
  }

  let lista: ItemCatalogo[];
  try {
    lista = (await vGetAll(endpoint))
      .map((x: any) => ({ id: Number(x.id), nome: String(x.name || "").trim() }))
      .filter((x) => x.id && x.nome);
  } catch (e) {
    if (salvo) { _catMem.set(chave, { at: Date.now(), lista: salvo.lista }); return salvo.lista; }
    throw e;
  }
  if (!lista.length && salvo) return salvo.lista;

  _catMem.set(chave, { at: Date.now(), lista });
  try {
    await supabaseAdmin().from("vobi_cache").upsert(
      { chave, dados: lista, atualizado_em: new Date().toISOString() }, { onConflict: "chave" },
    );
  } catch { /* idem */ }
  return lista;
}

/** Centros de custo (686: obras + OPERAÇÃO, CAPITAL DE GIRO, Projetos…). */
export const centrosDeCusto = () => catalogo("centros_custo", "payment-cost-center");
/** Categorias financeiras (120: Telefonia e Internet, Despesa de pessoal…). */
export const categoriasFinanceiras = () => catalogo("categorias_financeiras", "financial-category");

/** Busca por palavra dentro de um catálogo — mesmo criterio do fornecedor. */
export function buscarNoCatalogo(lista: ItemCatalogo[], termo: string, limite = 6): ItemCatalogo[] {
  const termoTodo = normalizar(termo);
  const palavras = palavrasDoTermo(termo);
  if (!palavras.length) return [];
  return lista
    .map((c) => ({ c, pontos: pontuarNome(c.nome, termoTodo, palavras) }))
    .filter((x) => x.pontos >= PONTOS_MINIMOS)
    .sort((a, b) => b.pontos - a.pontos || a.c.nome.length - b.c.nome.length)
    .slice(0, limite)
    .map((x) => x.c);
}

/**
 * Cadastra um fornecedor novo. `POST /supplier` exige só `name` (conferido na
 * spec da API). Invalida o cache para o novo aparecer na busca imediatamente.
 */
export async function criarFornecedor(nome: string): Promise<Fornecedor> {
  const limpo = nome.trim().toUpperCase().slice(0, 120);
  if (limpo.length < 2) throw new Error("nome de fornecedor muito curto");
  const criado = await vPost("/supplier", { name: limpo });
  const id = Number(criado?.id);
  if (!id) throw new Error("a Vobi nao devolveu o id do fornecedor");
  const novo: Fornecedor = { id, nome: limpo, razao: "" };
  _fornCache = _fornCache ? { at: _fornCache.at, lista: [..._fornCache.lista, novo] } : null;
  try {
    await supabaseAdmin().from("vobi_cache").delete().eq("chave", CHAVE_FORN);
  } catch { /* o cache expira sozinho em 24h de qualquer forma */ }
  return novo;
}

/**
 * O que esse fornecedor costuma usar de categoria e centro de custo.
 *
 * É o melhor palpite que existe e custa UMA requisição: a VIVO, por exemplo,
 * tem os 10 últimos lançamentos todos em "Telefonia e Internet". Vale mais que
 * o chute da IA — e funciona mesmo com a IA fora do ar.
 */
export async function usoAnteriorDoFornecedor(
  idSupplier: number,
): Promise<{ categorias: number[]; centros: number[] }> {
  try {
    const j = await vGet(
      `/payment?limit=10&where[idSupplier]=${idSupplier}&order[0][0]=id&order[0][1]=DESC`,
    );
    const rows: any[] = j?.rows || [];
    const porFrequencia = (campo: string) => {
      const c = new Map<number, number>();
      for (const r of rows) {
        const v = Number(r?.[campo]);
        if (v) c.set(v, (c.get(v) || 0) + 1);
      }
      return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    };
    return { categorias: porFrequencia("idFinancialCategory"), centros: porFrequencia("idPaymentCostCenter") };
  } catch {
    return { categorias: [], centros: [] };
  }
}

export type NovoLancamento = {
  nome: string;              // vai em CAIXA ALTA (padrão da casa)
  valor: number;
  idSupplier: number;
  idCategoria: number;
  idCentroCusto: number;
  conta: number;             // conta bancária / cartão
  forma: number;             // idPaymentType
  /** true = já quitado (data = pagamento); false = em aberto (data = vencimento) */
  pago: boolean;
  data: string;              // AAAA-MM-DD
  autor?: string;
};

/**
 * Cria o lançamento na Vobi e CONFERE relendo — a API tem bug conhecido de
 * responder 200 sem persistir (ver vobiEscrita.ts), então nunca dizer "lancei"
 * sem ter visto a parcela existir.
 *
 * Status conferidos na base em 23/09/2026:
 *   em aberto → payment.idPaymentStatus 2 + installment.idInstallmentStatus 1
 *   quitado   → payment.idPaymentStatus 3 + installment.idInstallmentStatus 2
 */
export async function criarLancamento(d: NovoLancamento): Promise<{ id: string; conferido: boolean }> {
  if (!(d.valor > 0)) throw new Error("valor inválido");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.data)) throw new Error(`data inválida: ${d.data}`);
  if (!d.idSupplier || !d.idCategoria || !d.idCentroCusto) {
    // Regra da casa (memória vobi_padrao_lancamento): fornecedor, categoria e
    // centro de custo NUNCA ficam em branco — é o que faz a planilha agrupar.
    throw new Error("fornecedor, categoria e centro de custo são obrigatórios");
  }

  const nome = d.nome.trim().toUpperCase().slice(0, 120) || "LANCAMENTO";
  const parcela: any = {
    price: d.valor, percentage: 100, number: 1, dueDate: d.data,
    idInstallmentStatus: d.pago ? 2 : 1,
    idPaymentBankAccount: d.conta, idPaymentType: d.forma, description: nome,
  };
  if (d.pago) { parcela.paidDate = d.data; parcela.paidValue = d.valor; }

  const corpo: any = {
    name: nome, billType: "expense", value: d.valor, subTotal: d.valor, billingDate: d.data,
    idPaymentBankAccount: d.conta, idFinancialCategory: d.idCategoria,
    idPaymentCostCenter: d.idCentroCusto, idSupplier: d.idSupplier,
    ownBusiness: true, idCompany: ID_EMPRESA, idCompanyEntity: ID_ENTIDADE,
    idPaymentStatus: d.pago ? 3 : 2,
    annotation: `Lancado pelo comprovante enviado no Telegram${d.autor ? " por " + d.autor : ""}.`,
    isRecurrence: false, recurrenceId: null, interval: 0,
    frequency: null, lastRecurrenceDate: null, installments: [parcela],
  };

  const criado = await vPost("/payment", corpo);
  const id = criado?.id;
  if (!id) throw new Error("a Vobi nao devolveu o id do lancamento");

  // RELÊ: sem parcela, o lançamento não existe para nenhuma listagem.
  const ps = ((await vGet(`/installment?limit=20&where[idPayment]=${id}`))?.rows || [])
    .filter((i: any) => i.idPayment === id);
  const p = ps[0];
  const conferido = ps.length === 1 && !!p &&
    Math.abs(num(p.price) - d.valor) < 0.01 &&
    p.idInstallmentStatus === (d.pago ? 2 : 1);

  return { id: String(id), conferido };
}

// ───────────────────────── parcelas em aberto ─────────────────────────

export type ParcelaAberta = {
  id: string;
  idPayment: string;
  descricao: string;
  fornecedor: string | null;
  idFornecedor: number | null;
  valor: number; // valor atual da parcela (price)
  valorOriginal: number;
  vencimento: string; // AAAA-MM-DD
  diasAtraso: number; // >0 = vencida
  // categoria financeira do pagamento (payment.idFinancialCategory) — e por
  // ela que as prioridades de caixa sao reconhecidas (ver lib/prioridades.ts)
  idCategoria: number | null;
  /** "despesa" (billType expense) ou "receita" (income). Decide TUDO: quem e o
   *  outro lado (fornecedor x cliente), como o valor diferente e interpretado e
   *  que lista pode ser baixada. Nunca inferir pelo contexto — vem da parcela. */
  tipo: "despesa" | "receita";
  parcela: string; // "2/3" quando houver
};

function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function hojeISO(): string {
  // fuso de São Paulo (o servidor da Vercel roda em UTC)
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function diasEntre(dataISO: string, refISO: string): number {
  const a = Date.parse(dataISO + "T00:00:00Z");
  const b = Date.parse(refISO + "T00:00:00Z");
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86400000);
}

/**
 * Normaliza uma parcela da Vobi.
 *
 * O `outro` e o nome do outro lado do lancamento: FORNECEDOR numa despesa,
 * CLIENTE numa receita. Sao campos diferentes na Vobi (idSupplier x
 * idCompanyCustomer) e ate 17/09/2026 o codigo so sabia ler o de despesa —
 * toda receita saia sem nome nenhum no lembrete.
 */
function montarParcela(i: any, outro?: string | null): ParcelaAberta {
  const pay = i.payment || {};
  const venc = String(i.dueDate || "").slice(0, 10);
  return {
    id: i.id,
    idPayment: i.idPayment,
    descricao: String(pay.name || i.description || "Lançamento").trim(),
    fornecedor: outro ?? null,
    // guardado para o botão "Paguei" do lembrete: sem o id do fornecedor não dá
    // para reabrir a lista de vencimentos daquele lançamento
    // numa receita o "outro lado" e o CLIENTE (idCompanyCustomer); guardado
    // para o botao do lembrete conseguir reabrir os lancamentos daquele lado
    idFornecedor: Number(pay.idSupplier) || Number(pay.idCompanyCustomer) || null,
    idCategoria: Number(pay.idFinancialCategory) || null,
    valor: num(i.price),
    valorOriginal: num(i.originalValue) || num(i.price),
    vencimento: venc,
    diasAtraso: venc ? diasEntre(venc, hojeISO()) : 0,
    parcela: i.number ? String(i.number) : "",
    tipo: (i.payment || {}).billType === "income" ? "receita" : "despesa",
  };
}

/** Parcelas de DESPESA em aberto (status 1) de um fornecedor específico.
 *  O filtro por idSupplier é feito na query da Vobi (where[$payment.idSupplier$]). */
export async function parcelasAbertasDoFornecedor(idSupplier: number, nome?: string): Promise<ParcelaAberta[]> {
  const rows = await vGetAll(
    "installment",
    `&where[idInstallmentStatus]=1&where[$payment.billType$]=expense&where[$payment.idSupplier$]=${idSupplier}`,
    6,
  );
  return rows
    .map((i: any) => montarParcela(i, nome ?? null))
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento));
}

export type Candidata = ParcelaAberta & {
  diferenca: number; // valorPago - valor da parcela (positivo = juros/multa)
  exata: boolean;
};

/**
 * Dado o fornecedor e QUANTO foi pago, devolve as parcelas mais prováveis.
 *
 * Por que isso existe: fornecedor grande (ex.: Leroy Merlin) tem 100+ parcelas
 * em aberto — listar todas no Telegram é inviável. O valor pago é o filtro que
 * discrimina. Como a Adriana paga em ATRASO, o valor pago costuma ser IGUAL ou
 * MAIOR que o da parcela (juros/multa), quase nunca menor — então ordenamos
 * pelas de valor igual primeiro, depois as que ficam abaixo do valor pago
 * (diferença = juros), e só então as demais.
 */
export async function parcelasCandidatas(
  idSupplier: number,
  valorPago: number,
  nome?: string,
  limite = 6,
): Promise<Candidata[]> {
  const todas = await parcelasAbertasDoFornecedor(idSupplier, nome);
  const centavos = (v: number) => Math.round(v * 100);
  const pago = centavos(valorPago);

  const comDif = todas.map((p) => {
    const dif = Math.round((valorPago - p.valor) * 100) / 100;
    return { ...p, diferenca: dif, exata: centavos(p.valor) === pago };
  });

  comDif.sort((a, b) => {
    // 1º valor exato; 2º pagou a mais (juros) — quanto menor o acréscimo, mais provável;
    // 3º pagou a menos (raro). Empate: vencimento mais antigo primeiro.
    const faixa = (c: Candidata) => (c.exata ? 0 : c.diferenca > 0 ? 1 : 2);
    const fa = faixa(a), fb = faixa(b);
    if (fa !== fb) return fa - fb;
    if (fa === 1) return a.diferenca - b.diferenca;
    if (fa === 2) return Math.abs(a.diferenca) - Math.abs(b.diferenca);
    return a.vencimento.localeCompare(b.vencimento);
  });

  return comDif.slice(0, limite);
}

/** Parcelas de despesa em aberto que vencem no intervalo [de, ate] (inclusive).
 *  Usado pelos lembretes do dia e da semana. */
export async function vencimentosNoPeriodo(de: string, ate: string): Promise<ParcelaAberta[]> {
  const rows = await vGetAll(
    "installment",
    `&where[idInstallmentStatus]=1&where[$payment.billType$]=expense` +
      `&where[dueDate][gte]=${de}&where[dueDate][lte]=${ate}`,
    10,
  );
  const dentro = rows.filter((i: any) => {
    const d = String(i.dueDate || "").slice(0, 10);
    return d >= de && d <= ate; // defesa: se o filtro da API for ignorado, filtra aqui
  });
  const nomes = await mapaFornecedores(dentro);
  return dentro
    .map((i: any) => montarParcela(i, nomes[(i.payment || {}).idSupplier] ?? null))
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento) || b.valor - a.valor);
}

/**
 * Todas as contas a pagar EM ABERTO, em cache de 10 minutos.
 *
 * Tres perguntas diferentes precisam da mesma lista — quem deve, quanto deve e
 * o que vence — entao busca-se uma vez so. Sao ~1.300 linhas, 3 paginas.
 */
let _abertas: { linhas: any[]; ate: number } | null = null;
async function todasAbertas(): Promise<any[]> {
  if (_abertas && Date.now() < _abertas.ate) return _abertas.linhas;
  const linhas = await vGetAll(
    "installment",
    `&where[idInstallmentStatus]=1&where[$payment.billType$]=expense`,
    8,
  );
  _abertas = { linhas, ate: Date.now() + 10 * 60_000 };
  return linhas;
}

/** Os fornecedores que TEM conta a pagar em aberto (92 dos 2.540 do cadastro). */
export async function fornecedoresComContaEmAberto(): Promise<Set<number>> {
  const ids = new Set<number>();
  for (const i of await todasAbertas()) { const s = Number((i.payment || {}).idSupplier); if (s) ids.add(s); }
  return ids;
}

/** Contas em aberto DESTES fornecedores, a mais parecida com o valor pago primeiro. */
export async function parcelasAbertasDeFornecedores(ids: number[], valorPago: number, limite = 8): Promise<ParcelaAberta[]> {
  const alvo = new Set(ids);
  const linhas = (await todasAbertas()).filter((i: any) => alvo.has(Number((i.payment || {}).idSupplier)));
  const nomes = await mapaFornecedores(linhas);
  const todas = linhas
    .map((i: any) => montarParcela(i, nomes[(i.payment || {}).idSupplier] ?? null))
    .sort((a, b) => Math.abs(a.valor - valorPago) - Math.abs(b.valor - valorPago) || a.vencimento.localeCompare(b.vencimento));

  // Serie mensal (aluguel, parcelamento) vira 8 linhas identicas e nao ajuda a
  // escolher. Colapsa por fornecedor+valor, ficando a mais proxima de vencer —
  // EXCETO quando o valor bate exatamente com o pago: ai todas interessam, porque
  // a duvida passa a ser QUAL parcela da serie foi paga.
  const exata = (c: ParcelaAberta) => Math.round(c.valor * 100) === Math.round(valorPago * 100);
  if (todas.some(exata)) return todas.filter(exata).slice(0, limite);
  const vistos = new Set<string>();
  const unicas: ParcelaAberta[] = [];
  for (const c of todas) {
    const chave = `${c.idFornecedor ?? c.fornecedor}|${Math.round(c.valor * 100)}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    unicas.push(c);
  }
  return unicas.slice(0, limite);
}

/**
 * Parcelas de DESPESA em aberto com um valor especifico, de QUALQUER fornecedor.
 *
 * Existe porque o favorecido do comprovante nem sempre e o fornecedor do
 * lancamento: em deposito judicial o boleto sai no nome do tribunal (ex.:
 * "CAIXA ECONOMICA FEDERAL - TRT02" para o acordo trabalhista), em guia de
 * imposto sai no nome do orgao, e em pagamento por intermediario sai no nome do
 * intermediario. Nesses casos so o VALOR liga o comprovante a conta.
 */
export async function parcelasAbertasPorValor(valor: number, limite = 8): Promise<ParcelaAberta[]> {
  const rows = await todasAbertas();
  const centavos = (v: number) => Math.round(v * 100);
  const alvo = centavos(valor);
  const perto = rows.filter((i: any) => Math.abs(centavos(num(i.price)) - alvo) <= 100); // ate 1 real de folga
  const nomes = await mapaFornecedores(perto);
  return perto
    .map((i: any) => montarParcela(i, nomes[(i.payment || {}).idSupplier] ?? null))
    .sort((a, b) => Math.abs(a.valor - valor) - Math.abs(b.valor - valor) || a.vencimento.localeCompare(b.vencimento))
    .slice(0, limite);
}

/** Parcelas de RECEITA em aberto que vencem no intervalo [de, ate].
 *  Usado pelo lembrete de prioridades para responder "o que entra ate la?". */
/**
 * Categorias de receita que NÃO são cliente pagando.
 *
 * Decisão da Adriana em 17/09/2026 ("só cliente pagando"): "Outras Receitas"
 * guarda as duas provisões de fim de ano — 001_IMPOSTOS ENGENHARIA
 * (R$ 364.557,67, com o INSS no lugar do cliente) e 002_LEILAO_MMM
 * (R$ 300.000, vencendo em 2027). Somá-las faria o "a receber" passar de
 * R$ 700 mil e esconder o que de fato vai entrar.
 */
const CAT_RECEITA_NAO_OPERACIONAL = new Set<number>([
  21796616, // Outras Receitas (as provisões de 31/12)
  21657983, // Outras Receitas e Entradas
  22957008, // Transferência entre Contas (receita) — dinheiro nosso, não do cliente
  21796618, // Ajuste Caixa
]);

/** Aluguel do apartamento: receita PESSOAL da Adriana, não da operação. Entra
 *  nos lembretes marcada e fora do total (decisão dela em 17/09/2026). */
export const CAT_ALUGUEL_PESSOAL = 21796622;

/**
 * É cliente pagando? Exclui provisão, transferência e o que está sem cliente
 * (a "DEVOLUCAO BLOQUEIO JUDICIAL_SISBAJUD" não tem cliente nenhum — é
 * devolução de bloqueio, não recebível).
 */
export function ehReceitaDeCliente(p: ParcelaAberta): boolean {
  if (CAT_RECEITA_NAO_OPERACIONAL.has(p.idCategoria ?? 0)) return false;
  if (!p.idFornecedor) return false; // em receita este campo carrega o cliente
  return !/TRANSFER[ÊE]NCIA ENTRE CONTAS|AJUSTE DE CAIXA|DEVOLUCAO BLOQUEIO/i.test(p.descricao || "");
}

/** É o aluguel pessoal? Mostrado com 🏠 e somado à parte. */
export const ehAluguelPessoal = (p: ParcelaAberta) => p.idCategoria === CAT_ALUGUEL_PESSOAL;

/**
 * TODAS as receitas em aberto, com o nome do cliente resolvido.
 *
 * São só 23 hoje (contra ~1.335 de despesa), então cabem numa página e o custo
 * é UMA requisição — dá para chamar à vontade. Cache curto porque o lembrete e
 * a busca por valor pedem a mesma lista na mesma execução.
 */
let _receitas: { linhas: ParcelaAberta[]; ate: number } | null = null;
export async function receitasAbertas(): Promise<ParcelaAberta[]> {
  if (_receitas && Date.now() < _receitas.ate) return _receitas.linhas;
  const rows = await vGetAll(
    "installment",
    `&where[idInstallmentStatus]=1&where[$payment.billType$]=income`,
    4,
  );
  const nomes = await mapaClientes(rows);
  const linhas = rows
    .map((i: any) => montarParcela(i, nomes[(i.payment || {}).idCompanyCustomer] ?? null))
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  _receitas = { linhas, ate: Date.now() + 10 * 60_000 };
  return linhas;
}

/** Receitas de CLIENTE que vencem no intervalo. */
export async function recebimentosNoPeriodo(de: string, ate: string): Promise<ParcelaAberta[]> {
  return (await receitasAbertas())
    .filter((p) => p.vencimento >= de && p.vencimento <= ate)
    .filter(ehReceitaDeCliente);
}

/** Receitas de CLIENTE já vencidas e não recebidas — a inadimplência. */
export async function recebimentosAtrasados(hoje: string): Promise<ParcelaAberta[]> {
  return (await receitasAbertas())
    .filter((p) => p.vencimento && p.vencimento < hoje)
    .filter(ehReceitaDeCliente);
}

/**
 * Receitas em aberto com um valor parecido com o recebido.
 *
 * A tolerância é MAIOR que a da despesa de propósito. Em despesa paga-se o
 * valor ou mais (juros), então ±R$ 1,00 basta. Em recebimento o cliente paga
 * A MENOS — retenção de imposto tira 1,5% a 5% — e é justamente essa diferença
 * que a Adriana quer flagrar. Aceitamos até 8% a menos e R$ 1,00 a mais.
 */
export async function receitasAbertasPorValor(valor: number, limite = 8): Promise<ParcelaAberta[]> {
  const perto = (await receitasAbertas()).filter((p) => {
    const dif = p.valor - valor; // >0 = recebeu menos que a conta
    return dif >= -1 && dif <= p.valor * 0.08 + 0.01;
  });
  return perto
    .sort((a, b) => Math.abs(a.valor - valor) - Math.abs(b.valor - valor) || a.vencimento.localeCompare(b.vencimento))
    .slice(0, limite);
}

/** Resolve idSupplier -> nome para um conjunto de parcelas (usa o cache global). */
async function mapaFornecedores(linhas: any[]): Promise<Record<number, string>> {
  const ids = new Set<number>();
  for (const i of linhas) {
    const id = (i.payment || {}).idSupplier;
    if (id) ids.add(id);
  }
  if (!ids.size) return {};
  const mapa: Record<number, string> = {};
  for (const f of await fornecedores()) if (ids.has(f.id)) mapa[f.id] = f.nome;
  return mapa;
}

/** Uma parcela específica, já montada (para confirmar antes da baixa). */
export async function parcelaPorId(idInstallment: string): Promise<ParcelaAberta | null> {
  const j = await vGet(`/installment?limit=1&where[id]=${encodeURIComponent(idInstallment)}`);
  const i = (j?.rows || [])[0];
  if (!i) return null;
  // O outro lado do lançamento muda com o tipo: fornecedor na despesa, CLIENTE
  // na receita. Buscar fornecedor numa receita não só devolve nada como, nos
  // poucos lançamentos de receita que têm idSupplier preenchido por engano,
  // carimbaria um nome de fornecedor onde deveria estar o do cliente.
  const ehReceita = (i.payment || {}).billType === "income";
  const nomes = ehReceita ? await mapaClientes([i]) : await mapaFornecedores([i]);
  const chave = ehReceita ? (i.payment || {}).idCompanyCustomer : (i.payment || {}).idSupplier;
  return montarParcela(i, nomes[chave] ?? null);
}

/**
 * A parcela ainda está EM ABERTO?
 *
 * `parcelaPorId` devolve a parcela em qualquer status — e o botão do lembrete de
 * ontem continua clicável no Telegram para sempre. Sem esta checagem, um toque
 * repetido reescreveria uma baixa já feita, apagando o desconto e os juros que
 * já estavam gravados.
 */
export async function parcelaEmAberto(idInstallment: string): Promise<boolean> {
  const j = await vGet(`/installment?limit=1&where[id]=${encodeURIComponent(idInstallment)}`);
  const i = (j?.rows || [])[0];
  return !!i && Number(i.idInstallmentStatus) === 1;
}

// ─────────────────────────────── a baixa ───────────────────────────────

export type DadosBaixa = {
  idInstallment: string;
  valorPago: number; // o que saiu da conta de verdade
  dataPagamento: string; // AAAA-MM-DD
  idPaymentBankAccount?: number;
  idPaymentType?: number;
  /**
   * Valor REAL da conta (o que era devido), quando ele mudou em relação ao que
   * está na Vobi — ex.: energia elétrica, que é apuração de consumo, ou uma
   * revisão de valor da parcela. Sem isso, a diferença entre o pago e o que
   * estava lançado viraria juros, o que nem sempre é verdade.
   */
  valorConta?: number;
  /** Se não vier, é calculado: valorPago - valorConta (quando positivo). */
  juros?: number;
  multa?: number;
  desconto?: number;
  observacao?: string;
};

export type ResultadoCartao = {
  ok: boolean;
  idInstallment: string;
  descricao: string;
  /** o que estava na Vobi antes */
  valorAntes: number;
  /** o valor REAL da conta usado na soma (igual a valorAntes quando não mudou) */
  valorConta: number;
  valorDepois: number;
  juros: number;
  vencimentoAntes: string;
  vencimentoDepois: string;
  cartao: string;
  mensagem: string;
};

/**
 * Pagamento no CARTÃO DE CRÉDITO (regra da Adriana, 16/09/2026).
 *
 * A parcela NÃO é baixada — o fornecedor recebeu, mas o dinheiro só sai da
 * conta quando a FATURA vencer. Então empurramos o vencimento para o dia 02 do
 * mês seguinte e somamos os juros do cartão, deixando a parcela EM ABERTO.
 *
 * ATENÇÃO — POR QUE ISSO É FEITO PELO /payment E NÃO PELO /installment:
 * o `PUT /installment/{id}` responde 200 mas IGNORA `dueDate` e `price` (só
 * persiste os campos de baixa). Medido em 16/09/2026. O único caminho que
 * realmente altera vencimento/valor é o `PUT /payment/{id}` mandando o ARRAY
 * COMPLETO de parcelas + o `value` somando exatamente os prices.
 *
 * E é obrigatório mandar TODAS as parcelas do pagamento: um lançamento
 * recorrente (a Enel tem 7) recria as parcelas a cada PUT. Mandar só uma
 * devolve 400 ("Valor total das parcelas diferente...") — a Vobi protege
 * contra apagar as irmãs, mas não confie nisso: montamos o array inteiro.
 * Efeito colateral aceito: as parcelas ganham IDs novos.
 */
export async function rolarParaCartao(
  idInstallment: string,
  dados: { juros: number; idCartao: number; nomeCartao?: string; vencimentoFatura?: string; novoValorConta?: number },
  opts: { dryRun?: boolean } = {},
): Promise<ResultadoCartao> {
  const antes = await parcelaPorId(idInstallment);
  const venc = dados.vencimentoFatura || proximoVencimentoCartao();
  const base: ResultadoCartao = {
    ok: false,
    idInstallment,
    descricao: antes?.descricao || "",
    valorAntes: antes?.valor || 0,
    valorConta: dados.novoValorConta ?? antes?.valor ?? 0,
    valorDepois: 0,
    juros: dados.juros,
    vencimentoAntes: antes?.vencimento || "",
    vencimentoDepois: venc,
    cartao: dados.nomeCartao || CARTOES.find((c) => c.id === dados.idCartao)?.nome || String(dados.idCartao),
    mensagem: "",
  };
  if (!antes) return { ...base, mensagem: "Parcela não encontrada na Vobi (ou já não está em aberto)." };

  const valorConta = dados.novoValorConta ?? antes.valor;
  const novoValor = Math.round((valorConta + (dados.juros || 0)) * 100) / 100;

  // todas as parcelas irmãs (o PUT recria o conjunto inteiro)
  const irmas = await vGetAll("installment", `&where[idPayment]=${encodeURIComponent(antes.idPayment)}`, 2, "dueDate");
  if (!irmas.length) return { ...base, mensagem: "Não consegui ler as parcelas do lançamento na Vobi." };

  const linhas = irmas.map((i: any) => {
    const ehAlvo = i.id === idInstallment;
    const preco = ehAlvo ? novoValor : num(i.price);
    // A Vobi NÃO persiste `interest` por este caminho (medido: volta 0), então o
    // juros do cartão fica embutido no valor. Para não perder a informação,
    // registramos na descrição da parcela — é o que aparece na tela da Vobi.
    const descBase = String(i.description || `Parcela ${i.number ?? 1}`).replace(/\s*\(\+ R\$ [\d.,]+ juros cartão\)\s*$/i, "");
    const desc = ehAlvo && dados.juros > 0
      ? `${descBase} (+ R$ ${dados.juros.toFixed(2).replace(".", ",")} juros cartão)`.slice(0, 190)
      : descBase;
    return {
      price: preco,
      dueDate: ehAlvo ? venc : String(i.dueDate).slice(0, 10),
      number: i.number ?? 1,
      description: desc,
      idInstallmentStatus: i.idInstallmentStatus ?? 1,
      ...(i.paidDate ? { paidDate: String(i.paidDate).slice(0, 10) } : {}),
      // A CONTA NÃO MUDA (regra da Adriana, 16/09/2026): a fatura do cartão vai
      // ser paga pelo Santander, então o dinheiro sai de lá. O cartão é só a
      // FORMA — é ela que registra "o fornecedor já recebeu, falta a fatura".
      ...(ehAlvo
        ? {
            interest: dados.juros || 0,
            idPaymentType: FORMA_CARTAO,
            ...(i.idPaymentBankAccount ? { idPaymentBankAccount: i.idPaymentBankAccount } : {}),
          }
        : {
            ...(num(i.interest) ? { interest: num(i.interest) } : {}),
            ...(i.idPaymentType ? { idPaymentType: i.idPaymentType } : {}),
            ...(i.idPaymentBankAccount ? { idPaymentBankAccount: i.idPaymentBankAccount } : {}),
          }),
    };
  });

  // a Vobi exige que a soma dos percentuais dê 100 e que `value` = soma dos prices
  const total = Math.round(linhas.reduce((s, l) => s + l.price, 0) * 100) / 100;
  let acumulado = 0;
  linhas.forEach((l: any, idx) => {
    if (idx === linhas.length - 1) l.percentage = Math.round((100 - acumulado) * 100) / 100;
    else {
      const p = Math.round((l.price / total) * 10000) / 100;
      l.percentage = p;
      acumulado += p;
    }
  });

  // A DESPESA tem forma de pagamento própria, no cabeçalho — mandar só dentro
  // da parcela deixava a tela da Vobi com "Forma de pagamento: Selecione".
  // `paymentTypes` (array de {value}) é esse campo; confirmado no spec
  // (PaymentType 3 = cartão de crédito).
  // A CONTA fica de fora de propósito: não enviar preserva a que já estava
  // (Santander), que é de onde a fatura do cartão vai ser paga.
  const corpo = {
    value: total,
    paymentTypes: [{ value: FORMA_CARTAO }],
    installments: linhas,
  };

  if (opts.dryRun) {
    return { ...base, ok: true, valorDepois: novoValor, mensagem: `SIMULAÇÃO — enviaria: ${JSON.stringify(corpo).slice(0, 400)}` };
  }

  await vPut(`/payment/${encodeURIComponent(antes.idPayment)}`, corpo);

  // conferência: a parcela alvo ganhou id novo, então procuramos pelo vencimento
  const depois = await vGetAll("installment", `&where[idPayment]=${encodeURIComponent(antes.idPayment)}`, 2, "dueDate");
  const alvo = depois.find((i: any) => String(i.dueDate).slice(0, 10) === venc && Math.abs(num(i.price) - novoValor) < 0.01);
  const gravou = !!alvo && depois.length === irmas.length;

  return {
    ...base,
    ok: gravou,
    valorDepois: alvo ? num(alvo.price) : novoValor,
    mensagem: gravou
      ? "Conta transferida para a fatura do cartão."
      : `A Vobi aceitou mas não encontrei a parcela em ${venc} com ${novoValor} ` +
        `(parcelas antes: ${irmas.length}, depois: ${depois.length}). Confira na Vobi.`,
  };
}

export type ResultadoAjuste = {
  ok: boolean;
  /** o PUT /payment RECRIA as parcelas: o id muda. Use este daqui adiante. */
  idNovo: string;
  valorAntes: number;
  valorDepois: number;
  mensagem: string;
};

/**
 * Muda o VALOR de uma parcela em aberto.
 *
 * POR QUE ISSO EXISTE (medido em 16/09/2026, três experimentos controlados):
 * na baixa a Vobi **ignora** `price` e `originalValue`. Ela usa o valor
 * ARMAZENADO da parcela e calcula `price = armazenado + interest + fine −
 * discount`. Então, quando a conta mudou de valor (energia é apuração de
 * consumo; parcelas às vezes são revisadas), é obrigatório corrigir o valor
 * ANTES de baixar — senão o valor novo simplesmente não entra.
 *
 * O único caminho que altera valor de verdade é o `PUT /payment/{id}` com o
 * array COMPLETO de parcelas (o `PUT /installment` também ignora `price`).
 */
export async function ajustarValorParcela(
  idInstallment: string,
  novoValor: number,
  opts: { dryRun?: boolean } = {},
): Promise<ResultadoAjuste> {
  const antes = await parcelaPorId(idInstallment);
  const base: ResultadoAjuste = {
    ok: false, idNovo: idInstallment, valorAntes: antes?.valor || 0, valorDepois: novoValor, mensagem: "",
  };
  if (!antes) return { ...base, mensagem: "Parcela não encontrada na Vobi." };
  if (Math.abs(antes.valor - novoValor) < 0.01) {
    return { ...base, ok: true, valorDepois: antes.valor, mensagem: "O valor já era esse." };
  }

  // TODAS as parcelas do lançamento: o PUT recria o conjunto inteiro e recusa
  // um array que não some o total ("Valor total das parcelas diferente").
  const irmas = await vGetAll("installment", `&where[idPayment]=${encodeURIComponent(antes.idPayment)}`, 2, "dueDate");
  if (!irmas.length) return { ...base, mensagem: "Não consegui ler as parcelas do lançamento na Vobi." };

  const linhas = irmas.map((i: any) => ({
    price: i.id === idInstallment ? novoValor : num(i.price),
    dueDate: String(i.dueDate).slice(0, 10),
    number: i.number ?? 1,
    description: String(i.description || `Parcela ${i.number ?? 1}`).slice(0, 190),
    idInstallmentStatus: i.idInstallmentStatus ?? 1,
    ...(i.paidDate ? { paidDate: String(i.paidDate).slice(0, 10) } : {}),
    ...(num(i.interest) ? { interest: num(i.interest) } : {}),
    ...(i.idPaymentType ? { idPaymentType: i.idPaymentType } : {}),
    ...(i.idPaymentBankAccount ? { idPaymentBankAccount: i.idPaymentBankAccount } : {}),
  }));

  // a Vobi exige `value` = soma dos prices e percentuais somando 100
  const total = Math.round(linhas.reduce((s, l) => s + l.price, 0) * 100) / 100;
  let acumulado = 0;
  linhas.forEach((l: any, idx) => {
    if (idx === linhas.length - 1) l.percentage = Math.round((100 - acumulado) * 100) / 100;
    else {
      const p = Math.round((l.price / total) * 10000) / 100;
      l.percentage = p;
      acumulado += p;
    }
  });

  const corpo = { value: total, installments: linhas };
  if (opts.dryRun) {
    return { ...base, ok: true, mensagem: `SIMULAÇÃO — enviaria: ${JSON.stringify(corpo).slice(0, 400)}` };
  }

  await vPut(`/payment/${encodeURIComponent(antes.idPayment)}`, corpo);

  // a parcela ganhou id novo: reencontramos pelo vencimento + valor
  const depois = await vGetAll("installment", `&where[idPayment]=${encodeURIComponent(antes.idPayment)}`, 2, "dueDate");
  const alvo = depois.find(
    (i: any) => String(i.dueDate).slice(0, 10) === antes.vencimento && Math.abs(num(i.price) - novoValor) < 0.01,
  );
  if (!alvo || depois.length !== irmas.length) {
    return {
      ...base,
      mensagem: `A Vobi aceitou mas não encontrei a parcela de ${antes.vencimento} com ${novoValor} ` +
        `(parcelas antes: ${irmas.length}, depois: ${depois.length}).`,
    };
  }
  return { ...base, ok: true, idNovo: String(alvo.id), valorDepois: num(alvo.price), mensagem: "Valor da conta corrigido." };
}

export type ResultadoBaixa = {
  ok: boolean;
  idInstallment: string;
  descricao: string;
  valorOriginal: number;
  valorPago: number;
  juros: number;
  multa: number;
  desconto: number;
  statusDepois: number | null;
  paidDateDepois: string | null;
  mensagem: string;
};

const STATUS_PAGO_MANUAL = 4;

/** Quanto passou do valor original vira juros (a Adriana paga em atraso). */
export function calcularAcrescimo(valorOriginal: number, valorPago: number): { juros: number; desconto: number } {
  const dif = Math.round((valorPago - valorOriginal) * 100) / 100;
  if (dif > 0) return { juros: dif, desconto: 0 };
  if (dif < 0) return { juros: 0, desconto: Math.abs(dif) };
  return { juros: 0, desconto: 0 };
}

/**
 * Dá baixa numa parcela. SEMPRE relê depois para confirmar que gravou —
 * a Vobi já demonstrou PUT que responde 200 sem persistir.
 * `dryRun` simula: não escreve nada e devolve o que faria.
 */
export async function darBaixa(dados: DadosBaixa, opts: { dryRun?: boolean } = {}): Promise<ResultadoBaixa> {
  let idAlvo = dados.idInstallment;
  let antes = await parcelaPorId(idAlvo);
  if (!antes) {
    return {
      ok: false, idInstallment: dados.idInstallment, descricao: "", valorOriginal: 0,
      valorPago: dados.valorPago, juros: 0, multa: 0, desconto: 0,
      statusDepois: null, paidDateDepois: null,
      mensagem: "Parcela não encontrada na Vobi (ou já não está em aberto).",
    };
  }

  // Base do cálculo: o valor que a conta REALMENTE tinha. Normalmente é o que
  // está na Vobi, mas quem lançou pode ter corrigido (energia por consumo,
  // revisão de parcela...) — nesse caso a diferença NÃO é juros.
  const valorConta = dados.valorConta ?? antes.valorOriginal;

  // A Vobi IGNORA `price`/`originalValue` na baixa e calcula a partir do valor
  // ARMAZENADO. Então, se a conta mudou de valor, corrigimos a parcela ANTES —
  // senão o valor novo some e o lançamento fica pelo valor velho.
  let ajuste: ResultadoAjuste | null = null;
  if (Math.abs(valorConta - antes.valor) >= 0.01) {
    ajuste = await ajustarValorParcela(idAlvo, valorConta, opts);
    if (!ajuste.ok) {
      return {
        ok: false, idInstallment: idAlvo, descricao: antes.descricao, valorOriginal: antes.valor,
        valorPago: dados.valorPago, juros: 0, multa: 0, desconto: 0,
        statusDepois: null, paidDateDepois: null,
        mensagem: `Não consegui corrigir o valor da conta (${antes.valor} → ${valorConta}): ${ajuste.mensagem} Nada foi baixado.`,
      };
    }
    if (!opts.dryRun) {
      idAlvo = ajuste.idNovo; // o PUT /payment recria a parcela com id novo
      antes = (await parcelaPorId(idAlvo)) || antes;
    }
  }
  const auto = calcularAcrescimo(valorConta, dados.valorPago);
  const juros = dados.juros ?? auto.juros;
  const multa = dados.multa ?? 0;
  const desconto = dados.desconto ?? auto.desconto;

  // Semântica da Vobi (confirmada em baixas reais da própria base):
  //   originalValue = valor devido antes dos encargos
  //   price         = valor EFETIVAMENTE pago (original + multa + juros − desconto)
  // Ex. real: originalValue 2.405,68 + fine 96,23 + interest 1,60 = price 2.503,51.
  // Nas parcelas em aberto o originalValue vem NULO, então gravamos aqui o valor
  // que estava devido — sem isso o histórico perde quanto era a conta original.
  const corpo: Record<string, any> = {
    idInstallmentStatus: STATUS_PAGO_MANUAL,
    paidDate: dados.dataPagamento,
    originalValue: valorConta,
    price: dados.valorPago,
    interest: juros,
    fine: multa,
    discount: desconto,
    idPaymentBankAccount: dados.idPaymentBankAccount ?? CONTA_PADRAO,
    idPaymentType: dados.idPaymentType ?? FORMA_PADRAO,
  };
  if (dados.observacao) corpo.description = dados.observacao;

  const base: ResultadoBaixa = {
    ok: false,
    idInstallment: idAlvo,
    descricao: antes.descricao,
    valorOriginal: valorConta,
    valorPago: dados.valorPago,
    juros, multa, desconto,
    statusDepois: null,
    paidDateDepois: null,
    mensagem: "",
  };

  if (opts.dryRun) {
    return { ...base, ok: true, mensagem: `SIMULAÇÃO — nada foi gravado. Enviaria: ${JSON.stringify(corpo)}` };
  }

  await vPut(`/installment/${encodeURIComponent(idAlvo)}`, corpo);

  // CONFERÊNCIA OBRIGATÓRIA: relê a parcela e exige que tenha virado paga
  // E que o valor gravado seja o que a pessoa disse ter pago. Checar só o
  // status deixou passar um erro real (16/09/2026): a Vobi marcou como paga
  // mantendo o valor antigo, e o bot avisou "confirmado".
  const j = await vGet(`/installment?limit=1&where[id]=${encodeURIComponent(idAlvo)}`);
  const dep: any = (j?.rows || [])[0] || {};
  const status = dep.idInstallmentStatus ?? null;
  const pago = typeof status === "number" && status >= 2 && status <= 11;
  const valorGravado = num(dep.price);
  const valorBate = Math.abs(valorGravado - dados.valorPago) < 0.01;

  return {
    ...base,
    ok: pago && valorBate,
    statusDepois: status,
    paidDateDepois: dep.paidDate ? String(dep.paidDate).slice(0, 10) : null,
    mensagem: pago && valorBate
      ? "Baixa confirmada na Vobi."
      : !pago
        ? `A Vobi aceitou a chamada mas a parcela NÃO consta como paga (status=${status}). ` +
          `Não considere baixada — confira na Vobi e avise a Adriana.`
        : `A parcela foi marcada como paga, mas com ${valorGravado.toFixed(2)} em vez de ` +
          `${dados.valorPago.toFixed(2)}. Confira na Vobi antes de considerar resolvida.`,
  };
}
