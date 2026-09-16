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

const VOBI = "https://api.vobi.com.br/v2";

function creds() {
  const uuid = process.env.VOBI_UUID ?? import.meta.env.VOBI_UUID;
  const secret = process.env.VOBI_SECRET ?? import.meta.env.VOBI_SECRET;
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

async function vGet(path: string): Promise<any> {
  const r = await fetch(`${VOBI}${path}`, { headers: { authorization: `Bearer ${await token()}` } });
  if (!r.ok) throw new Error(`Vobi GET ${path}: HTTP ${r.status}`);
  return r.json();
}

async function vPut(path: string, body: any): Promise<any> {
  const r = await fetch(`${VOBI}${path}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
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

// ──────────────────────────── fornecedores ────────────────────────────

export type Fornecedor = { id: number; nome: string; razao: string };

let _fornCache: { at: number; lista: Fornecedor[] } | null = null;

/**
 * Lista de fornecedores (~2.540), em cache de 1h.
 *
 * Por que baixar tudo: a API da Vobi NÃO tem busca por texto — operadores como
 * [$iLike] devolvem 400 e `where[name]` exige o nome EXATO. Então a busca por
 * pedaço do nome é feita aqui, em memória (6 chamadas, ~1,5s, só 1x por hora).
 *
 * NÃO filtrar por isActive: o LEROY MERLIN que concentra 152 parcelas em aberto
 * está cadastrado como isActive=false.
 */
export async function fornecedores(): Promise<Fornecedor[]> {
  if (_fornCache && Date.now() - _fornCache.at < 60 * 60 * 1000) return _fornCache.lista;
  const rows = await vGetAll("supplier");
  const lista = rows
    .map((f: any) => ({
      id: f.id,
      nome: String(f.name || f.companyName || f.fantasyName || "").trim(),
      razao: String(f.legalName || "").trim(),
    }))
    .filter((f) => f.id && (f.nome || f.razao));
  _fornCache = { at: Date.now(), lista };
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
 * Quando a busca literal não acha nada (o cadastro da Vobi tem erros de
 * digitação — "D4SING" no lugar de "D4SIGN"), tenta uma aproximação simples:
 * casa quem compartilha um prefixo de 4+ letras com o termo.
 */
export async function buscarFornecedoresAproximado(termo: string, limite = 6): Promise<Fornecedor[]> {
  const exatos = await buscarFornecedores(termo, limite);
  if (exatos.length) return exatos;
  const t = normalizar(termo).replace(/\s+/g, "");
  if (t.length < 4) return [];
  const pref = t.slice(0, 4);
  return (await fornecedores())
    .filter((f) => {
      const n = normalizar(f.nome).replace(/\s+/g, "");
      const r = normalizar(f.razao).replace(/\s+/g, "");
      return n.includes(pref) || r.includes(pref);
    })
    .slice(0, limite);
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

function montarParcela(i: any, nomeFornecedor?: string | null): ParcelaAberta {
  const pay = i.payment || {};
  const venc = String(i.dueDate || "").slice(0, 10);
  return {
    id: i.id,
    idPayment: i.idPayment,
    descricao: String(pay.name || i.description || "Lançamento").trim(),
    fornecedor: nomeFornecedor ?? null,
    // guardado para o botão "Paguei" do lembrete: sem o id do fornecedor não dá
    // para reabrir a lista de vencimentos daquele lançamento
    idFornecedor: Number(pay.idSupplier) || null,
    valor: num(i.price),
    valorOriginal: num(i.originalValue) || num(i.price),
    vencimento: venc,
    diasAtraso: venc ? diasEntre(venc, hojeISO()) : 0,
    parcela: i.number ? String(i.number) : "",
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
  const nomes = await mapaFornecedores([i]);
  return montarParcela(i, nomes[(i.payment || {}).idSupplier] ?? null);
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
      ...(ehAlvo
        ? { interest: dados.juros || 0, idPaymentType: FORMA_CARTAO, idPaymentBankAccount: dados.idCartao }
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

  const corpo = { value: total, installments: linhas };

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
