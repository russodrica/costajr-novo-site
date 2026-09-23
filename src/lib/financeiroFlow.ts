// Fluxo de BAIXA DE PAGAMENTO no grupo financeiro do Telegram (@cjr_adm_bot).
//
// Como a Adriana pediu (16/09/2026):
//   1. alguém do grupo manda "1400 construtivo" (valor + fornecedor), ou o
//      comprovante (foto/PDF) — a IA lê e extrai valor/fornecedor/data
//   2. o bot acha as parcelas EM ABERTO daquele fornecedor — inclusive as
//      VENCIDAS, porque ela quase sempre paga com atraso
//   3. escolhido o vencimento, pergunta COMO foi pago:
//      • dinheiro/PIX/boleto → BAIXA a parcela
//      • CARTÃO DE CRÉDITO   → NÃO baixa! empurra o vencimento para o dia 02 do
//        mês seguinte (fatura) e soma os juros do cartão, deixando em aberto
//   3b. se o valor pago NÃO bate com o da Vobi, PERGUNTA o que houve — juros/
//      multa ou o valor da conta mudou (energia é apuração de consumo, e
//      parcelas às vezes são revisadas). Nunca presumir que é juros.
//   4. mostra o resumo e pergunta:  [✅ Sim] [❌ Não] [✏️ Alterar]
//      "Alterar" separa valor pago, valor da conta, juros e vencimento
//   5. confirmado, grava na Vobi e RELÊ para provar que gravou
//
// O estado de cada lançamento fica em telegram_sessoes na chave "fb:<token>" —
// o token viaja no callback_data, então várias pessoas podem lançar ao mesmo
// tempo no grupo sem uma atrapalhar a outra.

import { escTg } from "./telegram";
import { ehAPropriaCJR, identificarLado, type LadoCJR } from "./identidadeCJR";
import { type Bot, enviar, inline, baixarArquivoTg, extrairTextoConteudo } from "./telegramBot";
import { lerDocumentoLLM, gerarTextoLLM, llmConfigurado, extrairJson } from "./llm";
import {
  buscarFornecedoresAproximado, fornecedores, parcelasCandidatas, parcelasAbertasPorValor, fornecedoresComContaEmAberto, parcelasAbertasDeFornecedores, parcelasAbertasDoFornecedor, parcelaPorId, darBaixa,
  rolarParaCartao, proximoVencimentoCartao, calcularAcrescimo,
  CONTAS_PRINCIPAIS, FORMAS_PAGAMENTO, CARTOES,
  CONTAS_TRANSFERENCIA, contaPorTexto, nomeDaConta, criarTransferenciaEntreContas,
  receitasAbertasPorValor, parcelaEmAberto, receitasAbertas, ehReceitaDeCliente,
  CONTA_PADRAO, FORMA_PADRAO, FORMA_CARTAO, vobiBaixaConfigurada,
  centrosDeCusto, categoriasFinanceiras, buscarNoCatalogo, criarFornecedor, criarLancamento,
  parcelasAbertasDoFornecedor as todasAbertasDoFornecedor, ranquearCandidatas, combinacoesQueSomam,
  usoAnteriorDoFornecedor,
  type ItemCatalogo,
  type Candidata, type Fornecedor, type ParcelaAberta,
} from "./vobiBaixa";

const CHAVE_GRUPO = "grupo_financeiro";

// ───────────────────────────── helpers ─────────────────────────────

export function brl(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function dataBR(iso: string): string {
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

function hojeISO(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function novoToken(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

/** Lê o valor em reais de um texto livre: "1400", "1.400,00", "R$ 1400,50". */
export function extrairValor(texto: string): number | null {
  const t = texto.replace(/r\$\s*/gi, " ");
  const m = t.match(/\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+,\d{1,2}|\d+\.\d{2}(?!\d)|\d+/g);
  if (!m) return null;
  let melhor: number | null = null;
  for (const bruto of m) {
    let s = bruto;
    if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
    const n = Number(s);
    if (Number.isFinite(n) && n > 0 && (melhor === null || n > melhor)) melhor = n;
  }
  return melhor;
}

/** Tira do texto os números e palavras de comando, sobrando o nome do fornecedor. */
export function extrairNome(texto: string): string {
  return texto
    .replace(/r\$\s*[\d.,]+/gi, " ")
    .replace(/[\d.,]+/g, " ")
    .replace(/\b(paguei|pago|pagamento|baixa|baixar|dar baixa|quitei|de|da|do|das|dos|para|pra|no|na|em|reais|real|conta|fornecedor|a|o|as|os)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ───────────────────────── estado do lançamento ─────────────────────────

type EstadoBaixa = {
  chat_id: number;
  autor: string;
  valorPago: number;
  dataPagamento: string;
  fornecedor?: { id: number; nome: string };
  candidatas?: Candidata[];
  parcela?: { id: string; descricao: string; valor: number; vencimento: string; fornecedor: string | null };
  forma: number;
  /** a forma veio escrita no comprovante — não precisa perguntar "como foi pago?" */
  formaDoComprovante?: boolean;
  /** a conta de origem veio do comprovante (e não do padrão) */
  contaDoComprovante?: boolean;
  conta: number;
  cartao?: { id: number; nome: string };
  /**
   * Valor REAL da conta (sem juros). Só fica definido depois que a pessoa
   * resolve a diferença entre o pago e o que está na Vobi — porque a diferença
   * tanto pode ser juros quanto o próprio valor da conta ter mudado (energia é
   * apuração de consumo; parcelas às vezes são revisadas).
   */
  valorConta?: number;
  /** Juros/multa (ou juros do cartão) informados pela pessoa. */
  juros?: number;
  vencimentoFatura?: string;
  // transferencia entre contas da propria empresa
  transfOrigem?: number;
  transfDestino?: number;
  /** banco que o comprovante citou, so para marcar o botao provavel */
  transfBancoOrigem?: string;
  transfBancoDestino?: string;
  /** id da SAÍDA já gravada, quando a entrada falhou — "tentar de novo" grava
   *  só a ponta que falta, para o dinheiro não sair duas vezes */
  transfIdSaida?: string;

  /** "despesa" (o padrão, dinheiro saindo) ou "receita" (cliente pagando). O
   *  fluxo, as perguntas e o significado da diferença de valor mudam por aqui. */
  tipo?: "despesa" | "receita";
  /** por que o cliente pagou menos — vira o rótulo do desconto na Vobi */
  recMotivo?: string;
  etapa: string;
  /** o que a pessoa (ou o comprovante) deu como nome do fornecedor — guardado
   *  para o "🔄 Tentar de novo" refazer a busca sem pedir o comprovante de novo */
  nomeBusca?: string;
  /** combinações de parcelas que somam o valor pago (pagamento agrupado) */
  lotes?: { id: string; valor: number; vencimento: string; descricao: string }[][];
  /** o lote escolhido, esperando confirmação */
  loteEscolhido?: number;
  /** lançamento sendo CADASTRADO do zero (fluxo "Lançar") */
  novo?: NovoLanc;
  /** para não deixar um passo esquecido capturando mensagens do grupo o dia todo */
  atualizadoEm?: string;

  // nomes antigos — só para sessões que já estavam em andamento no deploy
  jurosCartao?: number;
  valorContaCartao?: number;
};

/** Valor da conta em si: o corrigido, senão o que está na Vobi. */
function contaDe(e: EstadoBaixa): number {
  return e.valorConta ?? e.valorContaCartao ?? e.parcela?.valor ?? e.valorPago;
}

/** Juros: o informado, senão o que sobra entre o pago e o valor da conta. */
function jurosDe(e: EstadoBaixa): number {
  if (e.juros != null) return e.juros;
  if (e.jurosCartao != null) return e.jurosCartao;
  if (e.forma === FORMA_CARTAO) return 0;
  return calcularAcrescimo(contaDe(e), e.valorPago).juros;
}

function descontoDe(e: EstadoBaixa): number {
  if (e.forma === FORMA_CARTAO) return 0;
  return calcularAcrescimo(contaDe(e), e.valorPago).desconto;
}

/** true quando ainda não sabemos se a diferença é juros ou valor novo da conta. */
function precisaResolverDiferenca(e: EstadoBaixa): boolean {
  if (!e.parcela) return false;
  if (e.valorConta != null || e.valorContaCartao != null || e.juros != null || e.jurosCartao != null) return false;
  return Math.abs(e.valorPago - e.parcela.valor) >= 0.01;
}

async function salvarEstado(db: any, token: string, dados: EstadoBaixa) {
  dados.atualizadoEm = new Date().toISOString();
  await db.from("telegram_sessoes").upsert(
    { telegram_user_id: "fb:" + token, chat_id: String(dados.chat_id), estado: dados.etapa, dados },
    { onConflict: "telegram_user_id" },
  );
}

async function lerEstado(db: any, token: string): Promise<EstadoBaixa | null> {
  const { data } = await db.from("telegram_sessoes").select("dados").eq("telegram_user_id", "fb:" + token).maybeSingle();
  return data?.dados || null;
}

async function apagarEstado(db: any, token: string) {
  await db.from("telegram_sessoes").delete().eq("telegram_user_id", "fb:" + token);
}

export async function getGrupoFinanceiro(db: any): Promise<string | null> {
  const { data } = await db.from("telegram_sessoes").select("dados").eq("telegram_user_id", CHAVE_GRUPO).maybeSingle();
  return data?.dados?.chat_id != null ? String(data.dados.chat_id) : null;
}

export async function ativarGrupoFinanceiro(db: any, chatId: number, titulo: string, quem: string) {
  await db.from("telegram_sessoes").upsert(
    { telegram_user_id: CHAVE_GRUPO, chat_id: String(chatId), estado: "ativo", dados: { chat_id: chatId, titulo, ativado_por: quem } },
    { onConflict: "telegram_user_id" },
  );
}

/** Todo passo que espera um número digitado precisa ter saída. */
const BOTOES_CANCELA = (token: string) => inline([
  [
    { text: "⬅️ Voltar", callback_data: `fbvolta:${token}` },
    { text: "❌ Cancelar", callback_data: `fbnao:${token}` },
  ],
]);

const BOTOES_CONFIRMA = (token: string) => inline([
  [
    { text: "✅ Sim", callback_data: `fbsim:${token}` },
    { text: "❌ Não", callback_data: `fbnao:${token}` },
    { text: "✏️ Alterar", callback_data: `fbalt:${token}` },
  ],
]);

// ───────────────────────── entrada: TEXTO ─────────────────────────

export async function onTextoFinanceiro(db: any, B: Bot, msg: any, chatId: number, texto: string) {
  if (!vobiBaixaConfigurada()) {
    await enviar(B, chatId, "⚠️ As credenciais da Vobi não estão configuradas — não consigo lançar.");
    return;
  }
  const valor = extrairValor(texto);
  const nome = extrairNome(texto);

  if (!valor) {
    await enviar(B, chatId, "Para lançar, me diga o <b>valor</b> e o <b>fornecedor</b>.\nEx.: <code>1400 construtivo</code>\n\nOu mande o <b>comprovante</b> (foto/PDF) que eu leio. 📎");
    return;
  }
  if (nome.length < 2) {
    await enviar(B, chatId, `Entendi o valor <b>${brl(valor)}</b>, mas não o fornecedor.\nMande assim: <code>${valor} nome do fornecedor</code>`);
    return;
  }
  await iniciar(db, B, chatId, autorDe(msg), valor, nome);
}

function autorDe(msg: any): string {
  return `${msg.from?.first_name || ""} ${msg.from?.last_name || ""}`.trim() || "alguém";
}

/** Núcleo: com valor + nome do fornecedor, encontra o fornecedor e segue. */
async function iniciar(
  db: any, B: Bot, chatId: number, autor: string, valor: number, nome: string, dataPag?: string,
  /** o que o comprovante já entregou pronto (forma, valor da conta, encargos) */
  lido?: { forma?: number; valorConta?: number; juros?: number; conta?: number },
) {
  const token = novoToken();
  const estado: EstadoBaixa = {
    chat_id: chatId,
    autor,
    valorPago: valor,
    dataPagamento: dataPag || hojeISO(),
    forma: lido?.forma ?? FORMA_PADRAO,
    formaDoComprovante: lido?.forma != null,
    // A conta de onde o dinheiro saiu: a que o comprovante disse, senão o
    // Santander (81% das baixas). Assumir sem avisar foi o que pôs o acordo do
    // Lysnor, pago pelo Villela, na conta errada.
    conta: lido?.conta ?? CONTA_PADRAO,
    contaDoComprovante: lido?.conta != null,
    valorConta: lido?.valorConta,
    juros: lido?.juros,
    nomeBusca: nome,
    etapa: "buscando",
  };

  await enviar(B, chatId, `🔎 Procurando <b>${escTg(nome)}</b> — ${brl(valor)}…`);
  await buscarFornecedorEContinuar(db, B, token, estado, chatId);
}

/**
 * A Vobi recusou (cota de 1000 req/h estourada, ou fora do ar). NÃO perdemos o
 * que já foi lido: guardamos o estado e oferecemos "Tentar de novo" — ler o
 * comprovante de novo custa uma chamada de IA e o tempo da pessoa.
 */
async function falhaDaVobi(
  db: any, B: Bot, token: string, estado: EstadoBaixa, chatId: number, e: any, oQue: string,
) {
  estado.etapa = "retry";
  await salvarEstado(db, token, estado);

  const cota = !!e?.cota;
  const espera = cota && e?.esperaSeg ? ` Ela volta em ~<b>${Math.ceil(e.esperaSeg / 60)} min</b>.` : "";
  const cabeca = cota
    ? `⏳ A Vobi bateu o limite de consultas da hora, então não consegui ${oQue}.${espera}`
    : `❌ Não consegui ${oQue}: ` + escTg(String(e?.message || e));

  await enviar(
    B, chatId,
    `${cabeca}

<b>Não precisa mandar o comprovante de novo</b> — já anotei ${brl(estado.valorPago)}` +
      `${estado.fornecedor ? " para " + escTg(estado.fornecedor.nome) : estado.nomeBusca ? " para " + escTg(estado.nomeBusca) : ""}.` +
      ` É só tocar em <b>Tentar de novo</b>.`,
    inline([
      [{ text: "🔄 Tentar de novo", callback_data: `fbretry:${token}` }],
      [{ text: "❌ Cancelar", callback_data: `fbnao:${token}` }],
    ]),
  );
}

/** Busca o fornecedor pelo nome guardado no estado e segue o fluxo. */
async function buscarFornecedorEContinuar(db: any, B: Bot, token: string, estado: EstadoBaixa, chatId: number) {
  const nome = estado.nomeBusca || "";

  let achados: Fornecedor[];
  try {
    achados = await buscarFornecedoresAproximado(nome, 30);
  } catch (e: any) {
    return await falhaDaVobi(db, B, token, estado, chatId, e, "consultar a Vobi");
  }

  // Regra da Adriana: comprovante so procura em quem tem conta EM ABERTO. Sem
  // isso a lista enche de homonimo que nao deve nada.
  try {
    const devendo = await fornecedoresComContaEmAberto();
    const comConta = achados.filter((f) => devendo.has(f.id));
    if (comConta.length) achados = comConta.slice(0, 6);
    else achados = [];
  } catch {
    achados = achados.slice(0, 6); // sem a lista de devedores, segue com o que veio
  }

  if (!achados.length) {
    // O estado PRECISA estar salvo aqui: os botoes abaixo (cadastrar, recebimento,
    // transferencia, procurar por valor) carregam o token e sem a sessao gravada
    // todos respondem "esse lancamento ja foi tratado ou expirou".
    estado.etapa = "sem_fornecedor";
    await salvarEstado(db, token, estado);
    await enviar(
      B,
      chatId,
      `❌ Nenhum fornecedor com <b>${escTg(nome)}</b> tem conta em aberto.\n\n<i>Num depósito judicial ou guia de imposto o favorecido do comprovante é o tribunal ou o órgão, não o fornecedor — nesses casos o que liga é o valor.</i>`,
      inline([
        [{ text: "➕ Cadastrar como lançamento novo", callback_data: `fbnovo:${token}` }],
        [{ text: "💰 Na verdade foi um RECEBIMENTO", callback_data: `fbreceb:${token}` }],
        [{ text: "🔁 Transferência entre nossas contas", callback_data: `fbtransf:${token}` }],
        [{ text: `🔎 Procurar contas de ${brl(estado.valorPago)}`, callback_data: `fbvalor:${token}` }],
        [{ text: "❌ Cancelar", callback_data: `fbnao:${token}` }],
      ]),
    );
    return;
  }

  if (achados.length === 1) {
    estado.fornecedor = { id: achados[0].id, nome: achados[0].nome || achados[0].razao };
    await salvarEstado(db, token, estado);
    return await mostrarParcelas(db, B, token, estado, chatId);
  }

  // Mostra a CONTA, nao o fornecedor: so o nome nao diz se e aquela despesa.
  let contas: ParcelaAberta[] = [];
  try {
    contas = await parcelasAbertasDeFornecedores(achados.map((f) => f.id), estado.valorPago, 8);
  } catch { contas = []; }
  if (!contas.length) {
    estado.fornecedor = { id: achados[0].id, nome: achados[0].nome || achados[0].razao };
    await salvarEstado(db, token, estado);
    return await mostrarParcelas(db, B, token, estado, chatId);
  }
  estado.candidatas = contas.map((c) => ({
    ...c,
    diferenca: Math.round((estado.valorPago - c.valor) * 100) / 100,
    exata: Math.round(c.valor * 100) === Math.round(estado.valorPago * 100),
  }));
  estado.etapa = "esc_parcela";
  await salvarEstado(db, token, estado);
  const linhas = contas.map((c, i) => {
    const quem = c.fornecedor ? escTg(c.fornecedor) : "<i>sem fornecedor</i>";
    const atraso = c.diasAtraso > 0 ? ` · <i>${c.diasAtraso}d em atraso</i>` : "";
    const igual = Math.round(c.valor * 100) === Math.round(estado.valorPago * 100) ? " ✅" : "";
    return `${i + 1}. <b>${dataBR(c.vencimento)}</b> — <b>${brl(c.valor)}</b>${igual}${atraso}\n    ${quem}\n    <i>${escTg(c.descricao.slice(0, 46))}</i>`;
  }).join("\n");
  const bts = contas.map((c) => [{
    text: `${dataBR(c.vencimento).slice(0, 5)} · ${brl(c.valor)} · ${(c.fornecedor || c.descricao).slice(0, 20)}`.slice(0, 60),
    callback_data: `fbparc:${token}:${c.id}`,
  }]);
  bts.push([{ text: "🔎 Não é nenhuma dessas", callback_data: `fbvalor:${token}` }]);
  bts.push([{ text: "❌ Cancelar", callback_data: `fbnao:${token}` }]);
  await enviar(
    B,
    chatId,
    `Contas em aberto que combinam com <b>${escTg(nome)}</b>:\n\n${linhas}\n\n<i>Qual delas?</i>`,
    inline(bts),
  );
}

// ═══════════════════════ NOVO LANÇAMENTO (cadastrar) ═══════════════════════
//
// Pedido da Adriana (23/09/2026): compra no cartão quase nunca está lançada na
// Vobi, então o bot precisa CADASTRAR, não só dar baixa. O gatilho é a legenda
// do comprovante começando com "Lançar":
//
//   Lançar - Chip Vivo - Cartão de crédito Nubank - CC Operação
//   └ comando   └ descrição   └ conta/cartão        └ centro de custo
//
// O que a legenda não disser, o bot pergunta com botões. Decisões dela:
// "já paguei / ainda vai vencer" é perguntado, e fornecedor novo só é criado
// depois de ela ver os parecidos e tocar em "criar".

type NovoLanc = {
  nome: string;
  valor: number;
  data: string;
  forma: number | null;
  conta: number | null;
  idSupplier?: number;
  fornecedorNome?: string;
  /** o que procurar no cadastro de fornecedores (estabelecimento do comprovante) */
  buscaForn?: string;
  idCategoria?: number;
  categoriaNome?: string;
  idCentroCusto?: number;
  ccNome?: string;
  pago?: boolean;
};

function normalizarTxt(s: string): string {
  return String(s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

/**
 * Qual conta a legenda indica. Um "cartão" NÃO pode cair na conta corrente de
 * mesmo nome: "Cartão de crédito Nubank" é o cartão 24624, não a conta Nubank
 * (24611) — foi o primeiro erro que apareceu no teste.
 */
function contaDaLegenda(texto: string): { conta: number | null; forma: number | null } {
  const t = normalizarTxt(texto);
  if (!t) return { conta: null, forma: null };
  if (/cart/.test(t)) {
    const c = CARTOES.find((x) =>
      normalizarTxt(x.nome).split(/\s+/).some((w) => w.length >= 3 && t.includes(w)));
    if (c) return { conta: c.id, forma: FORMA_CARTAO };
    if (CARTOES.length === 1) return { conta: CARTOES[0].id, forma: FORMA_CARTAO };
  }
  return { conta: contaPorTexto(texto), forma: null };
}

/** A legenda é um comando "Lançar - ..."? Devolve os pedaços já separados. */
export function lerComandoLancar(legenda: string): { descricao: string; conta: string; cc: string } | null {
  const t = String(legenda || "").trim();
  if (!/^lan[çc]ar\b/i.test(t)) return null;

  const partes = t.split(/\s+[-–—]\s+|\s*\n+\s*/).map((x) => x.trim()).filter(Boolean);
  partes.shift(); // tira o "Lançar"

  let descricao = "", conta = "", cc = "";
  for (const p of partes) {
    const mcc = p.match(/^(?:cc|centro de custo)\s*[:\-]?\s*(.+)$/i);
    if (mcc) { cc = cc || mcc[1].trim(); continue; }
    if (!conta && contaDaLegenda(p).conta) { conta = p; continue; }
    if (!descricao) { descricao = p; continue; }
    if (!cc) cc = p; // sobra sem rótulo no fim: trata como centro de custo
  }
  // "Lançar Chip Vivo" (sem hífen) também vale: o resto do texto é a descrição
  if (!descricao && !conta && !cc) descricao = t.replace(/^lan[çc]ar\b[\s:\-]*/i, "").trim();
  return { descricao, conta, cc };
}

/** Ponto de entrada: comprovante com legenda "Lançar", ou o botão "Cadastrar". */
export async function iniciarNovoLancamento(
  db: any, B: Bot, chatId: number, autor: string,
  d: { valor: number; data: string; forma?: number | null; descricao?: string; conta?: string; cc?: string; estabelecimento?: string },
  tokenExistente?: string,
) {
  const daLegenda = contaDaLegenda(d.conta || "");
  const novo: NovoLanc = {
    nome: (d.descricao || d.estabelecimento || "").trim(),
    valor: d.valor,
    data: d.data,
    forma: daLegenda.forma ?? d.forma ?? null,
    conta: daLegenda.conta,
    buscaForn: (d.estabelecimento || d.descricao || "").trim(),
  };

  // centro de custo pedido na legenda ("CC Operação") já resolve sozinho
  if (d.cc) {
    try {
      const achados = buscarNoCatalogo(await centrosDeCusto(), d.cc, 1);
      if (achados[0]) { novo.idCentroCusto = achados[0].id; novo.ccNome = achados[0].nome.trim(); }
    } catch { /* se a Vobi não responder, pergunta adiante */ }
  }

  const token = tokenExistente || novoToken();
  const estado: EstadoBaixa = {
    chat_id: chatId, autor,
    valorPago: d.valor, dataPagamento: d.data,
    forma: novo.forma ?? FORMA_PADRAO, conta: novo.conta ?? CONTA_PADRAO,
    etapa: "novo", novo,
  };
  await salvarEstado(db, token, estado);

  await enviar(B, chatId,
    `➕ <b>Novo lançamento</b> — ${brl(d.valor)} em ${dataBR(d.data)}` +
    (novo.nome ? `\n<b>O quê:</b> ${escTg(novo.nome)}` : "") +
    (novo.conta ? `\n<b>Conta:</b> ${escTg(nomeDaConta(novo.conta))}` : "") +
    (novo.ccNome ? `\n<b>Centro de custo:</b> ${escTg(novo.ccNome)}` : ""));
  return await proximoPassoNovo(db, B, token, estado, chatId);
}

/** Pede o próximo dado que falta; com tudo preenchido, mostra o resumo. */
async function proximoPassoNovo(db: any, B: Bot, token: string, estado: EstadoBaixa, chatId: number) {
  const n = estado.novo!;
  try {
    if (!n.idSupplier) return await pedirFornecedorNovo(db, B, token, estado, chatId);
    if (!n.idCategoria) return await pedirCategoriaNovo(db, B, token, estado, chatId);
    if (!n.idCentroCusto) return await pedirCentroCustoNovo(db, B, token, estado, chatId);
    if (!n.conta) return await pedirContaNovo(db, B, token, estado, chatId);
    if (n.pago === undefined) return await pedirPagoNovo(db, B, token, estado, chatId);
  } catch (e: any) {
    return await falhaDaVobi(db, B, token, estado, chatId, e, "montar o lançamento");
  }
  return await resumoNovo(db, B, token, estado, chatId);
}

async function pedirFornecedorNovo(db: any, B: Bot, token: string, estado: EstadoBaixa, chatId: number) {
  const n = estado.novo!;
  const termo = (n.buscaForn || n.nome || "").trim();
  const achados = termo.length >= 2 ? await buscarFornecedoresAproximado(termo, 5) : [];

  estado.etapa = "novo_forn";
  await salvarEstado(db, token, estado);

  const botoes = achados.map((f) => [{
    text: (f.nome || f.razao).slice(0, 55), callback_data: `fbnfor:${token}:${f.id}`,
  }]);
  if (termo.length >= 2) {
    botoes.push([{ text: `➕ Criar "${termo.slice(0, 28)}"`, callback_data: `fbnforcriar:${token}` }]);
  }
  botoes.push([{ text: "🔎 Procurar outro nome", callback_data: `fbnforbusca:${token}` }]);
  botoes.push([{ text: "❌ Cancelar", callback_data: `fbnao:${token}` }]);

  await enviar(B, chatId,
    achados.length
      ? `👤 <b>Qual é o fornecedor?</b>\n<i>Parecidos com “${escTg(termo)}”:</i>`
      : `👤 <b>Qual é o fornecedor?</b>\n<i>Não achei ninguém parecido com “${escTg(termo)}”.</i>`,
    inline(botoes));
}

/** A IA escolhe entre as categorias REAIS da Vobi — nunca inventa uma. */
async function sugerirCategoria(
  descricao: string, fornecedor: string, idSupplier?: number,
): Promise<ItemCatalogo[]> {
  const lista = await categoriasFinanceiras();

  // 1º o HISTÓRICO do próprio fornecedor — sinal mais forte que qualquer chute.
  if (idSupplier) {
    const uso = await usoAnteriorDoFornecedor(idSupplier);
    const hist = uso.categorias.map((id) => lista.find((c) => c.id === id)).filter(Boolean) as ItemCatalogo[];
    if (hist.length) return hist.slice(0, 3);
  }

  const porPalavra = buscarNoCatalogo(lista, `${descricao} ${fornecedor}`, 3);
  if (porPalavra.length || !llmConfigurado()) return porPalavra;
  try {
    const resp = await gerarTextoLLM(
      "Você classifica despesas de uma construtora. Responde SÓ um JSON.",
      [{ role: "user", content:
          `Despesa: "${descricao}" — fornecedor "${fornecedor}".\n` +
          `Escolha as 3 categorias MAIS provaveis desta lista (copie o texto exato):\n` +
          lista.map((c) => c.nome).join("\n") +
          `\n\nResponda {"categorias":["...","...","..."]}` }],
    );
    const j = extrairJson(resp || "");
    const nomes: string[] = Array.isArray(j?.categorias) ? j.categorias : [];
    const out: ItemCatalogo[] = [];
    for (const nm of nomes) {
      const achou = lista.find((c) => normalizarTxt(c.nome) === normalizarTxt(String(nm)));
      if (achou && !out.some((o) => o.id === achou.id)) out.push(achou);
    }
    return out.slice(0, 3);
  } catch { return []; }
}

async function pedirCategoriaNovo(db: any, B: Bot, token: string, estado: EstadoBaixa, chatId: number) {
  const n = estado.novo!;
  const sug = await sugerirCategoria(n.nome, n.fornecedorNome || "", n.idSupplier);
  estado.etapa = "novo_cat";
  await salvarEstado(db, token, estado);

  const botoes = sug.map((c) => [{ text: c.nome.trim().slice(0, 55), callback_data: `fbncat:${token}:${c.id}` }]);
  botoes.push([{ text: "🔎 Procurar outra categoria", callback_data: `fbncatbusca:${token}` }]);
  botoes.push([{ text: "❌ Cancelar", callback_data: `fbnao:${token}` }]);
  await enviar(B, chatId,
    sug.length
      ? `🗂 <b>Qual categoria?</b>`
      : `🗂 <b>Qual categoria?</b>\n<i>Toque em procurar e escreva um pedaço do nome.</i>`,
    inline(botoes));
}

async function pedirCentroCustoNovo(db: any, B: Bot, token: string, estado: EstadoBaixa, chatId: number) {
  estado.etapa = "novo_cc";
  await salvarEstado(db, token, estado);
  await enviar(B, chatId,
    `🏗 <b>Qual centro de custo?</b>\n<i>Escreva um pedaço (ex.: “operação”, “capital de giro”, o nome da obra).</i>`,
    BOTOES_CANCELA(token));
}

async function pedirContaNovo(db: any, B: Bot, token: string, estado: EstadoBaixa, chatId: number) {
  estado.etapa = "novo_conta";
  await salvarEstado(db, token, estado);
  const botoes = [
    ...CARTOES.map((c) => [{ text: `💳 ${c.nome}`, callback_data: `fbnconta:${token}:${c.id}` }]),
    ...CONTAS_PRINCIPAIS.map((c) => [{ text: `🏦 ${c.nome}`, callback_data: `fbnconta:${token}:${c.id}` }]),
    [{ text: "❌ Cancelar", callback_data: `fbnao:${token}` }],
  ];
  await enviar(B, chatId, `🏦 <b>Saiu de qual conta?</b>`, inline(botoes));
}

async function pedirPagoNovo(db: any, B: Bot, token: string, estado: EstadoBaixa, chatId: number) {
  estado.etapa = "novo_pago";
  await salvarEstado(db, token, estado);
  await enviar(B, chatId, `💰 <b>Essa conta já foi paga?</b>`, inline([
    [{ text: "✅ Já paguei", callback_data: `fbnpago:${token}:1` }],
    [{ text: "📅 Ainda vai vencer", callback_data: `fbnpago:${token}:0` }],
    [{ text: "❌ Cancelar", callback_data: `fbnao:${token}` }],
  ]));
}

async function resumoNovo(db: any, B: Bot, token: string, estado: EstadoBaixa, chatId: number) {
  const n = estado.novo!;
  estado.etapa = "novo_confirma";
  await salvarEstado(db, token, estado);
  const forma = FORMAS_PAGAMENTO.find((f) => f.id === n.forma)?.nome || "—";
  await enviar(B, chatId,
    `➕ <b>Conferir o lançamento</b>\n\n` +
    `<b>O quê:</b> ${escTg((n.nome || "").toUpperCase())}\n` +
    `<b>Fornecedor:</b> ${escTg(n.fornecedorNome || "—")}\n` +
    `<b>Valor:</b> ${brl(n.valor)}\n` +
    `<b>${n.pago ? "Pago em" : "Vence em"}:</b> ${dataBR(n.data)}\n` +
    `<b>Conta:</b> ${escTg(nomeDaConta(n.conta))}\n` +
    `<b>Forma:</b> ${escTg(forma)}\n` +
    `<b>Categoria:</b> ${escTg(n.categoriaNome || "—")}\n` +
    `<b>Centro de custo:</b> ${escTg(n.ccNome || "—")}\n\n` +
    `<i>Confirma que pode lançar na Vobi?</i>`,
    inline([
      [{ text: "✅ Lançar na Vobi", callback_data: `fbnok:${token}` }],
      [{ text: "✏️ Categoria", callback_data: `fbncatbusca:${token}` },
       { text: "✏️ Centro de custo", callback_data: `fbnccbusca:${token}` }],
      [{ text: "✏️ Conta", callback_data: `fbncontatroca:${token}` },
       { text: "✏️ Fornecedor", callback_data: `fbnforbusca:${token}` }],
      [{ text: "❌ Cancelar", callback_data: `fbnao:${token}` }],
    ]));
}

async function gravarNovoLancamento(db: any, B: Bot, token: string, estado: EstadoBaixa, chatId: number) {
  const n = estado.novo!;
  if (estado.etapa === "novo_gravando") {
    await enviar(B, chatId, "⏳ Já estou lançando esse — só um instante.");
    return;
  }
  estado.etapa = "novo_gravando";
  await salvarEstado(db, token, estado);

  try {
    const r = await criarLancamento({
      nome: n.nome, valor: n.valor, data: n.data,
      idSupplier: n.idSupplier!, idCategoria: n.idCategoria!, idCentroCusto: n.idCentroCusto!,
      conta: n.conta!, forma: n.forma ?? FORMA_PADRAO,
      pago: !!n.pago, autor: estado.autor,
    });
    await apagarEstado(db, token);
    await enviar(B, chatId,
      `✅ <b>Lançado na Vobi!</b>\n\n` +
      `${escTg((n.nome || "").toUpperCase())} — ${brl(n.valor)}\n` +
      `${n.pago ? "Pago" : "Vence"} em ${dataBR(n.data)} · ${escTg(nomeDaConta(n.conta))}\n` +
      `${escTg(n.categoriaNome || "")} · ${escTg(n.ccNome || "")}` +
      (r.conferido ? "" : `\n\n⚠️ <i>Gravei, mas não consegui reler a parcela para conferir — vale olhar na Vobi.</i>`));
  } catch (e: any) {
    estado.etapa = "novo_confirma";
    await salvarEstado(db, token, estado);
    await enviar(B, chatId,
      `❌ <b>Não consegui lançar:</b> ${escTg(String(e?.message || e).slice(0, 200))}\n\n` +
      `<i>Nada foi gravado. Pode tentar de novo.</i>`,
      inline([[{ text: "🔄 Tentar de novo", callback_data: `fbnok:${token}` }],
              [{ text: "❌ Cancelar", callback_data: `fbnao:${token}` }]]));
  }
}

// ───────────────────── entrada: COMPROVANTE (foto/PDF) ─────────────────────

const SYS_COMPROVANTE =
  "Você lê comprovantes bancários brasileiros (PIX, boleto, TED, DOC, cartão), " +
  "comprovantes de recebimento e prints de extrato, e extrai os dados EXATAMENTE " +
  "como estão impressos. Você nunca deduz um dado que não está escrito. Responda SÓ um JSON.";

const PEDIDO_COMPROVANTE = `Devolva JSON com as chaves:
{"sentido": "enviado" | "recebido" | null — SÓ o que o papel diz com todas as
   letras. "Comprovante de pagamento", "Pix enviado", "Transferência enviada" ->
   "enviado". "Comprovante de recebimento", "Você recebeu um Pix", "Pix recebido",
   "Transferência recebida", "crédito em conta" -> "recebido". Sem essa frase
   escrita, devolva null,
 "pagador": string (nome de quem PAGOU, de quem o dinheiro SAIU — vem sob
   "Pagador", "Dados do pagador", "Origem", "Debitado de", "Remetente", "De".
   Copie como está impresso, mesmo truncado),
 "pagador_documento": string (CPF/CNPJ do pagador COMO ESTÁ IMPRESSO, inclusive
   mascarado, ex.: "07.******/****-72"),
 "favorecido": string (nome de quem RECEBEU — vem sob "Favorecido",
   "Beneficiário", "Dados do recebedor", "Para", "Creditado em", "Destino"),
 "favorecido_documento": string (CPF/CNPJ do favorecido como está impresso),
 "valor": number (VALOR TOTAL efetivamente pago/recebido — o "Valor total", já
   com juros/IOF se houver),
 "valor_nominal": number (o valor da CONTA antes dos acréscimos — a linha
   "Valor". Se o comprovante não separar, use null),
 "encargos": number (soma de juros + multa + IOF + acréscimos. 0 se não houver,
   null se o comprovante não informar),
 "forma": string (um de: "pix", "boleto", "cartao_credito", "cartao_debito",
   "debito_em_conta", "transferencia", "dinheiro". null se não disser),
 "banco_origem": string (instituição de onde o dinheiro saiu),
 "banco_destino": string (instituição para onde o dinheiro foi),
 "data": "AAAA-MM-DD" (data do pagamento)}
NÃO deduza nem complete nada: se o papel não traz o campo, devolva null. Não
presuma quem é o pagador — copie o que está escrito.`;

/** "cartao_credito" → o id da forma de pagamento na Vobi. */
function formaDoTexto(v: unknown): number | null {
  // tira acento ANTES de limpar: "Cartão de crédito" precisa virar "cartaodecredito"
  const s = String(v || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
  if (!s) return null;
  // tabela PaymentType da Vobi (conferida no spec): 1 PIX · 2 Boleto ·
  // 3 Cartão de crédito · 4 Cartão de débito · 5 Transferência · 6 Dinheiro ·
  // 7 Outros · 8 Cheque · 9 Débito em conta · 10 Depósito · 11 Crédito em conta
  if (s.includes("credito") || s === "cartao") return FORMA_CARTAO; // 3
  if (s.includes("pix")) return 1;
  if (s.includes("boleto")) return 2;
  if (s.includes("cartao") && s.includes("debito")) return 4; // cartão de débito
  if (s.includes("debito")) return 9; // débito em conta
  if (s.includes("transferencia") || s.includes("ted") || s.includes("doc")) return 5;
  if (s.includes("dinheiro") || s.includes("especie")) return 6;
  if (s.includes("cheque")) return 8;
  if (s.includes("deposito")) return 10;
  return null;
}

/**
 * Só aceita a separação "valor da conta + encargos" quando o comprovante
 * REALMENTE separou as duas coisas.
 *
 * POR QUE TANTO RIGOR: num comprovante comum de PIX/boleto há uma linha só,
 * "Valor R$ 431,20". A IA devolve valor_nominal = total e encargos = 0, e uma
 * checagem ingênua ("nominal + encargos == total") aceita, porque 431,20 + 0 =
 * 431,20. Aí o bot concluiria sozinho que a conta passou a valer o que foi
 * pago — deixaria de fazer a pergunta obrigatória e ainda reescreveria o valor
 * da parcela na Vobi, apagando juros de atraso legítimos. Quando a informação
 * não está separada no papel, o certo é PERGUNTAR.
 */
function conferirDecomposicao(total: number, nominal: unknown, encargos: unknown) {
  const n = Number(nominal);
  if (!Number.isFinite(n) || n <= 0) return null;
  // CUIDADO: Number(null) é 0, não NaN. E deduzir encargos de (total − nominal)
  // torna a conferência uma tautologia: fecharia sempre, validando qualquer
  // número que a IA inventasse em valor_nominal. Exigimos os DOIS do papel.
  const informado = encargos !== null && encargos !== undefined && encargos !== "" && Number.isFinite(Number(encargos));
  if (!informado) return null;
  const enc = Math.round(Number(encargos) * 100) / 100;
  if (enc <= 0) return null; // "juros 0" não diz nada sobre o valor da conta
  if (Math.abs(n - total) < 0.01) return null; // nominal == total → nada foi separado
  if (Math.abs(n + enc - total) >= 0.01) return null; // as contas não fecham → não confio
  return { valorConta: Math.round(n * 100) / 100, juros: enc };
}

// ehAPropriaCJR vive em identidadeCJR.ts: e usada dos dois lados (pagamento,
// recebimento e transferencia) e precisa ser testavel sem arrastar o resto.

/**
 * Lê o comprovante em CAMADAS, igual ao bot de documentos:
 *   1. legenda da mensagem (se a pessoa escreveu algo junto)
 *   2. camada de TEXTO do PDF (unpdf) + um LLM de texto (Groq/Gemini/NVIDIA/Claude)
 *   3. visão (Gemini) — só para foto ou PDF escaneado, que não têm texto
 * A camada 2 é a que salva: não depende da cota do Gemini, que é apertada.
 */
export async function onComprovanteFinanceiro(db: any, B: Bot, msg: any, chatId: number) {
  let fileId = "", ct = "application/octet-stream", nome = "comprovante";
  if (msg.document) { fileId = msg.document.file_id; ct = msg.document.mime_type || ct; nome = msg.document.file_name || nome; }
  else if (msg.photo?.length) { fileId = msg.photo[msg.photo.length - 1].file_id; ct = "image/jpeg"; nome = "foto.jpg"; }
  if (!fileId) return;

  await enviar(B, chatId, "📎 Lendo o comprovante… ⏳");
  const buf = await baixarArquivoTg(B, fileId);
  if (!buf) { await enviar(B, chatId, "❌ Não consegui baixar o arquivo. Tente de novo."); return; }
  if (buf.length > 18 * 1024 * 1024) { await enviar(B, chatId, "❌ Arquivo muito grande (máx. ~18 MB)."); return; }

  const ctL = ct.toLowerCase();
  let valor: number | null = null;
  let favorecido = "";
  let data = "";
  let comoLi = "";
  let forma: number | null = null;
  let bruta: any = null; // o JSON da melhor leitura, p/ tirar valor_nominal/encargos
  // A CJR aparecendo dos DOIS lados quer dizer dinheiro andando entre as contas
  // Os DOIS lados, crus. Quem decide o que o papel é não é mais a ausência de
  // um nome: é a matriz pagador × favorecido lá embaixo.
  let pagador = "";
  let pagadorDoc = "";
  let favorecidoDoc = "";
  let sentido = "";
  let bancoOrigem = "";
  let bancoDestino = "";

  // ── CAMADA 1: legenda digitada junto com o arquivo ──
  // ATENÇÃO: "Lançar - Chip Vivo - Cartão Nubank - CC Operação" é um COMANDO,
  // não o nome de quem recebeu. Antes a legenda inteira virava o favorecido e
  // o bot saía procurando uma empresa chamada "Lançar - Chip Vivo - ..." — foi
  // exatamente o que a Adriana viu em 23/09/2026.
  const legenda = String(msg.caption || "").trim();
  const cmdLancar = lerComandoLancar(legenda);
  if (legenda && !cmdLancar) {
    valor = extrairValor(legenda);
    const n = extrairNome(legenda);
    if (n.length >= 2) favorecido = n;
    if (valor && favorecido) comoLi = "pela legenda";
  }

  const usar = (j: any, de: string) => {
    if (!j) return;
    if (!valor) valor = Number(j.valor) || null;
    // O nome da CJR agora é DADO, não lixo: é ele que diz de que lado ela está.
    if (!favorecido) favorecido = String(j.favorecido || "").trim();
    if (!favorecidoDoc) favorecidoDoc = String(j.favorecido_documento || "").trim();
    if (!pagador) pagador = String(j.pagador || "").trim();
    if (!pagadorDoc) pagadorDoc = String(j.pagador_documento || "").trim();
    if (!sentido) sentido = String(j.sentido || "").trim().toLowerCase();
    if (!bancoOrigem) bancoOrigem = String(j.banco_origem || "").trim();
    if (!bancoDestino) bancoDestino = String(j.banco_destino || "").trim();
    if (!data && /^\d{4}-\d{2}-\d{2}$/.test(String(j.data || ""))) data = String(j.data);
    if (forma == null) forma = formaDoTexto(j.forma);
    if (!bruta) bruta = j;
    if (valor && (favorecido || pagador) && !comoLi) comoLi = de;
  };

  // ── CAMADA 2: texto de dentro do PDF (sem IA) + LLM de texto ──
  const texto = await extrairTextoConteudo(buf, ctL, nome);
  if (texto && llmConfigurado() && (!valor || (!pagador && !favorecido) || forma == null)) {
    const resp = await gerarTextoLLM(SYS_COMPROVANTE, [
      { role: "user", content: `${PEDIDO_COMPROVANTE}\n\nCOMPROVANTE:\n${texto.slice(0, 6000)}` },
    ]).catch(() => null);
    usar(resp ? extrairJson(resp) : null, "do texto do comprovante");
  }

  // ── CAMADA 3: visão — foto, ou PDF escaneado (sem camada de texto) ──
  let erroVisao = "";
  if ((!valor || (!pagador && !favorecido) || forma == null) && (ctL === "application/pdf" || ctL.startsWith("image/"))) {
    const r = await lerDocumentoLLM(SYS_COMPROVANTE, PEDIDO_COMPROVANTE, buf.toString("base64"), ct)
      .catch((e: any) => ({ texto: null, provedor: "", erro: String(e?.message || e) }));
    erroVisao = r.erro;
    if (r.texto) {
      const j = extrairJson(r.texto);
      // PONTO CEGO que custou uma rodada de teste: o leitor RESPONDEU (erro
      // vazio) mas a resposta não era JSON — aí a falha ficava sem explicação.
      if (!j) erroVisao = `${r.provedor} respondeu fora de JSON: ${r.texto.slice(0, 80)}`;
      else {
        usar(j, "lendo a imagem");
        if (!valor || (!pagador && !favorecido)) erroVisao = `${r.provedor} leu mas devolveu ${JSON.stringify(j).slice(0, 80)}`;
      }
    }
  }

  if (!data) data = hojeISO();

  // Sem favorecido mas COM valor: pode ser transferencia entre as contas da
  // propria CJR. A Adriana: "o comprovante da Villela nao vem com o nome da
  // ── sem valor não dá para fazer nada ──
  if (!valor) {
    const porque = erroVisao ? `\n<i>(leitura por imagem: ${escTg(erroVisao.slice(0, 110))})</i>` : "";
    await enviar(B, chatId,
      `🤔 Não consegui identificar <b>o valor</b> nesse comprovante.${porque}\n\n` +
      `Me manda assim: <code>431,20 nome do fornecedor</code>`);
    return;
  }

  // ── quem está de cada lado? ──
  const vTotal = valor; // já conferido acima; fixa o tipo para as closures abaixo

  // "Lançar" é ordem explícita: NÃO passa pela matriz pagador × favorecido nem
  // procura conta em aberto — vai direto cadastrar na Vobi.
  if (cmdLancar) {
    await enviar(B, chatId,
      `📄 <b>Li do comprovante</b> <i>(${comoLi || "lendo o arquivo"})</i>:
` +
      `<b>Estabelecimento:</b> ${escTg(favorecido || "—")}
` +
      `<b>Valor:</b> ${brl(vTotal)}
<b>Data:</b> ${dataBR(data)}`);
    return await iniciarNovoLancamento(db, B, chatId, autorDe(msg), {
      valor: vTotal, data, forma,
      descricao: cmdLancar.descricao, conta: cmdLancar.conta, cc: cmdLancar.cc,
      estabelecimento: favorecido,
    });
  }

  const idP = identificarLado(pagador, pagadorDoc);
  const idF = identificarLado(favorecido, favorecidoDoc);
  let P: LadoCJR = idP.lado;
  let F: LadoCJR = idF.lado;

  // O papel dizendo "recebido"/"enviado" com todas as letras desempata quando
  // um dos lados não foi nomeado — num app de banco o dono da conta é implícito.
  if (sentido === "recebido" && F === "desconhecido" && P !== "cjr") F = "cjr";
  if (sentido === "enviado" && P === "desconhecido" && F !== "cjr") P = "cjr";

  const novoEstadoTransf = async (auto: boolean) => {
    const tk = novoToken();
    const est: EstadoBaixa = {
      chat_id: chatId, autor: autorDe(msg), valorPago: valor!, dataPagamento: data,
      forma: 5, formaDoComprovante: true, conta: CONTA_PADRAO,
      transfBancoOrigem: bancoOrigem, transfBancoDestino: bancoDestino,
      nomeBusca: favorecido || pagador, etapa: "transf_origem",
    };
    await salvarEstado(db, tk, est);
    return await pedirContaTransf(B, tk, est, chatId, "origem", auto);
  };

  // ── TRANSFERÊNCIA: a empresa dos dois lados ──
  if (P === "cjr" && F === "cjr") return await novoEstadoTransf(true);

  // ── RECEITA: alguém pagou a Costa Júnior ──
  if (F === "cjr" && P !== "cjr") {
    return await iniciarRecebimento(db, B, chatId, autorDe(msg), valor, pagador, data, bancoDestino);
  }

  // ── DESPESA: o caminho mais comum, e não pode ganhar atrito ──
  if (F === "terceiro" && P !== "terceiro") {
    return await anunciarESeguirDespesa();
  }
  if (P === "cjr" && F === "terceiro") return await anunciarESeguirDespesa();

  // ── não deu para afirmar: PERGUNTA em vez de chutar ──
  {
    const tk = novoToken();
    const est: EstadoBaixa = {
      chat_id: chatId, autor: autorDe(msg), valorPago: valor, dataPagamento: data,
      forma: forma ?? FORMA_PADRAO, formaDoComprovante: forma != null, conta: CONTA_PADRAO,
      transfBancoOrigem: bancoOrigem, transfBancoDestino: bancoDestino,
      nomeBusca: favorecido || pagador, etapa: "esc_tipo",
    };
    await salvarEstado(db, tk, est);
    // ninguém foi nomeado dos dois lados — é o formato do comprovante do Villela
    const semNinguem = !pagador && !favorecido;
    const quem =
      (pagador ? `<b>Pagou:</b> ${escTg(pagador)}\n` : "") +
      (favorecido ? `<b>Recebeu:</b> ${escTg(favorecido)}\n` : "");
    await enviar(
      B, chatId,
      `🤔 <b>Não consegui afirmar o que é este comprovante.</b>\n` +
        `<b>Valor:</b> ${brl(valor)} · <b>Data:</b> ${dataBR(data)}\n${quem}\n` +
        (semNinguem
          ? `<i>O comprovante do Banco Villela é assim — não traz nome. Se foi dinheiro ` +
            `andando entre as contas da Costa Júnior, é o primeiro botão.</i>`
          : `<i>O que foi?</i>`),
      // Quando o papel não nomeia NINGUÉM, a transferência entre contas vem
      // primeiro: foi o pedido da Adriana em 17/09/2026, porque o comprovante do
      // Villela é justamente assim. Continua sendo escolha dela — o bot não
      // inventa dois lançamentos sozinho.
      inline(
        (semNinguem
          ? [
              [{ text: "🔁 Transferência entre nossas contas", callback_data: `fbtransf:${tk}` }],
              [{ text: "💸 Paguei um fornecedor", callback_data: `fbdesp:${tk}` }],
              [{ text: "💰 Recebi de um cliente", callback_data: `fbreceb:${tk}` }],
            ]
          : [
              [{ text: "💸 Paguei um fornecedor", callback_data: `fbdesp:${tk}` }],
              [{ text: "💰 Recebi de um cliente", callback_data: `fbreceb:${tk}` }],
              [{ text: "🔁 Transferência entre nossas contas", callback_data: `fbtransf:${tk}` }],
            ]
        ).concat([[{ text: "❌ Cancelar", callback_data: `fbnao:${tk}` }]]),
      ),
    );
    return;
  }
  /** Caminho mais comum: a empresa pagou um terceiro. Zero atrito. */
  async function anunciarESeguirDespesa() {
    const alvo = favorecido || pagador;
    // O comprovante do cartão já separa "Valor" de "Juros"/"IOF" — se as contas
    // fecharem com o total, aproveitamos e não perguntamos nada disso.
    const dec = conferirDecomposicao(vTotal, bruta?.valor_nominal, bruta?.encargos);
    const nomeForma = FORMAS_PAGAMENTO.find((f) => f.id === forma)?.nome;

    let txt = `📄 <b>Li do comprovante</b> <i>(${comoLi})</i>:\n`;
    if (pagador) txt += `<b>Pagou:</b> ${escTg(pagador)}\n`;
    txt += `<b>Favorecido:</b> ${escTg(alvo)}\n`;
    if (dec && dec.juros > 0) {
      txt += `<b>Valor da conta:</b> ${brl(dec.valorConta)}\n`;
      txt += `<b>Juros/encargos:</b> ${brl(dec.juros)}\n`;
      txt += `<b>Total pago:</b> ${brl(vTotal)}\n`;
    } else {
      txt += `<b>Valor:</b> ${brl(vTotal)}\n`;
    }
    txt += `<b>Data:</b> ${dataBR(data)}\n`;
    if (nomeForma) txt += `<b>Forma:</b> ${escTg(nomeForma)}\n`;
    await enviar(B, chatId, txt);

    await iniciar(db, B, chatId, autorDe(msg), vTotal, alvo, data, {
      conta: contaPorTexto(bancoOrigem) ?? undefined,
      forma: forma ?? undefined,
      valorConta: dec?.valorConta,
      juros: dec?.juros,
    });
  }
}

/**
 * Um terceiro pagou a Costa Júnior: acha a RECEITA correspondente e entra na
 * conferência de valor.
 *
 * A busca é por nome do cliente primeiro e por valor depois. São só ~23
 * receitas em aberto, então tudo isso sai de uma lista já em cache — nenhuma
 * requisição extra na Vobi.
 */
async function iniciarRecebimento(
  db: any, B: Bot, chatId: number, autor: string, valor: number,
  nomeCliente: string, dataPag: string, bancoDestino?: string,
) {
  const tk = novoToken();
  const estado: EstadoBaixa = {
    chat_id: chatId, autor, valorPago: valor, dataPagamento: dataPag,
    forma: FORMA_PADRAO, conta: contaPorTexto(bancoDestino) ?? CONTA_PADRAO,
    tipo: "receita", nomeBusca: nomeCliente, etapa: "rec_busca",
  };
  await salvarEstado(db, tk, estado);

  await enviar(
    B, chatId,
    `💰 <b>Entendi como RECEBIMENTO</b>\n` +
      (nomeCliente ? `<b>Quem pagou:</b> ${escTg(nomeCliente)}
` : "") +
      `<b>Valor:</b> ${brl(valor)} · <b>Data:</b> ${dataBR(dataPag)}
\n` +
      `<i>Procurando a receita…</i>`,
  );

  let abertas;
  try {
    abertas = (await receitasAbertas()).filter(ehReceitaDeCliente);
  } catch (e: any) {
    return await falhaDaVobi(db, B, tk, estado, chatId, e, "procurar a receita");
  }

  const chave = normalizarBusca(nomeCliente);
  const porNome = chave.length >= 3
    ? abertas.filter((p) => normalizarBusca(p.fornecedor || "").includes(chave) || chave.includes(normalizarBusca(p.fornecedor || "")))
    : [];
  // valor bate exato ganha de tudo: é a pista mais forte que existe
  const exatas = abertas.filter((p) => Math.abs(p.valor - valor) < 0.005);
  const porValor = await receitasAbertasPorValor(valor, 8).catch(() => [] as typeof abertas);

  const candidatas = [...exatas, ...porNome, ...porValor].filter(
    (p, i, arr) => arr.findIndex((x) => x.id === p.id) === i,
  ).slice(0, 8);

  if (!candidatas.length) {
    await enviar(
      B, chatId,
      `❌ Não achei nenhuma receita em aberto que combine com ${brl(valor)}` +
        (nomeCliente ? ` ou com <b>${escTg(nomeCliente)}</b>` : "") + `.
\n` +
        `<i>Talvez a receita ainda não esteja lançada na Vobi. Lance lá e me mande o comprovante de novo.</i>`,
      inline([
        [{ text: "💸 Na verdade foi um PAGAMENTO", callback_data: `fbdesp:${tk}` }],
        [{ text: "❌ Encerrar", callback_data: `fbnao:${tk}` }],
      ]),
    );
    return;
  }

  if (candidatas.length === 1) return await abrirRecebimento(db, B, tk, estado, chatId, candidatas[0]);

  const linhas = candidatas.map((c, i) => {
    const igual = Math.abs(c.valor - valor) < 0.005 ? " ✅" : "";
    const atraso = c.diasAtraso > 0 ? ` · <i>${c.diasAtraso}d em atraso</i>` : "";
    return `${i + 1}. <b>${dataBR(c.vencimento)}</b> — <b>${brl(c.valor)}</b>${igual}${atraso}\n` +
      `    ${c.fornecedor ? escTg(c.fornecedor) : "<i>sem cliente</i>"}\n` +
      `    <i>${escTg(c.descricao.slice(0, 46))}</i>`;
  }).join("\n");
  const bts = candidatas.map((c) => [{
    text: `${dataBR(c.vencimento)} · ${brl(c.valor)} · ${(c.fornecedor || c.descricao).slice(0, 20)}`.slice(0, 60),
    callback_data: `fbrecp:${tk}:${c.id}`,
  }]);
  bts.push([{ text: "❌ Cancelar", callback_data: `fbnao:${tk}` }]);
  await enviar(B, chatId, `Receitas em aberto que combinam:

${linhas}

<i>Qual delas?</i>`, inline(bts));
}

/** Fixa a receita escolhida e pergunta quanto entrou de verdade. */
async function abrirRecebimento(db: any, B: Bot, token: string, estado: EstadoBaixa, chatId: number, p: any) {
  estado.tipo = "receita";
  estado.parcela = { id: p.id, descricao: p.descricao, valor: p.valor, vencimento: p.vencimento, fornecedor: p.fornecedor };
  estado.etapa = "rec_valor";
  await salvarEstado(db, token, estado);
  const atraso = p.diasAtraso > 0 ? ` · <i>${p.diasAtraso} dias em atraso</i>` : "";
  const bate = Math.abs(p.valor - estado.valorPago) < 0.005;
  await enviar(
    B, chatId,
    `📥 <b>Recebimento</b>
${escTg(p.fornecedor || "sem cliente")}\n` +
      `<i>${escTg(String(p.descricao).slice(0, 45))}</i>\n` +
      `Venc. ${dataBR(p.vencimento)}${atraso}
<b>A receita é de ${brl(p.valor)}</b>\n` +
      (bate ? `<b>Entrou ${brl(estado.valorPago)}</b> — bate certinho.
` : `<b>O comprovante diz ${brl(estado.valorPago)}.</b>
`) +
      `
<i>Confirma o valor que entrou na conta?</i>`,
    inline([
      [{ text: `✅ Entrou ${brl(estado.valorPago)}`, callback_data: `fbrconf:${token}` }],
      [{ text: "✏️ Entrou outro valor", callback_data: `fbroutro:${token}` }],
      [{ text: "❌ Cancelar", callback_data: `fbnao:${token}` }],
    ]),
  );
}

/** Normaliza para comparar nome de cliente com o que veio no comprovante. */
function normalizarBusca(s: string): string {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 14);
}

// ───────────────────────── escolha da parcela ─────────────────────────

/**
 * Desenha a lista de bancos para a pessoa dizer de onde saiu / para onde foi.
 * Marca o que o comprovante sugeriu, mas quem decide e ela.
 */
async function pedirContaTransf(
  B: Bot, token: string, estado: EstadoBaixa, chatId: number, lado: "origem" | "destino", auto = false,
) {
  const dica = lado === "origem" ? estado.transfBancoOrigem : estado.transfBancoDestino;
  const provavel = contaPorTexto(dica);
  const acao = lado === "origem" ? "fbtde" : "fbtpara";
  const fora = lado === "destino" ? estado.transfOrigem : null; // ninguem transfere para si mesma

  const linhas: any[] = [];
  const contas = CONTAS_TRANSFERENCIA.filter((c) => c.id !== fora);
  for (let i = 0; i < contas.length; i += 2) {
    linhas.push(contas.slice(i, i + 2).map((c) => ({
      text: (c.id === provavel ? "⭐ " : "") + c.nome,
      callback_data: `${acao}:${token}:${c.id}`,
    })));
  }

  let txt: string;
  if (lado === "destino") {
    txt =
      `🔁 Saiu de <b>${escTg(nomeDaConta(estado.transfOrigem))}</b> — ${brl(estado.valorPago)}` +
      `\n\n<i>Para qual conta ENTROU?</i>`;
  } else if (auto) {
    txt =
      `🔁 <b>Transferência entre contas da Costa Júnior</b>\n` +
      `<b>Valor:</b> ${brl(estado.valorPago)}\n<b>Data:</b> ${dataBR(estado.dataPagamento)}\n\n` +
      `<i>De qual conta SAIU?</i>`;
    linhas.push([
      { text: "💸 Foi pagamento", callback_data: `fbdesp:${token}` },
      { text: "💰 Foi recebimento", callback_data: `fbreceb:${token}` },
    ]);
  } else {
    txt =
      `🤔 Esse comprovante veio <b>sem o nome do favorecido</b>.\n` +
      `<b>Valor:</b> ${brl(estado.valorPago)}\n<b>Data:</b> ${dataBR(estado.dataPagamento)}\n\n` +
      `<i>O comprovante do Banco Villela é assim. Se foi dinheiro andando entre as `+
      `contas da Costa Júnior, me diga de qual conta SAIU:</i>`;
    linhas.push([{
      text: `🔎 Não é transferência — procurar conta de ${brl(estado.valorPago)}`,
      callback_data: `fbvalor:${token}`,
    }]);
  }
  linhas.push([{ text: "❌ Cancelar", callback_data: `fbnao:${token}` }]);
  await enviar(B, chatId, txt, inline(linhas));
}

async function mostrarParcelas(db: any, B: Bot, token: string, estado: EstadoBaixa, chatId: number) {
  const f = estado.fornecedor!;
  let cands: Candidata[];
  let todas: ParcelaAberta[] = [];
  try {
    todas = await todasAbertasDoFornecedor(f.id, f.nome);
    cands = ranquearCandidatas(todas, estado.valorPago, 6);
  } catch (e: any) {
    return await falhaDaVobi(db, B, token, estado, chatId, e, "buscar as parcelas em aberto");
  }

  // UM pagamento pode quitar VÁRIAS parcelas (PIX de 620 = 425 + 195). Se a
  // soma bate exatamente, oferece o lote ANTES da lista solta — senão ela baixa
  // uma só e a diferença vira "juros" que nunca existiram.
  const combos = combinacoesQueSomam(todas, estado.valorPago, 3);
  estado.lotes = combos.map((c) => c.map((p) => ({
    id: p.id, valor: p.valor, vencimento: p.vencimento, descricao: p.descricao,
  })));

  if (!cands.length) {
    // NAO apaga o estado: daqui ela ainda pode cadastrar o lancamento do zero.
    await enviar(B, chatId,
      `❌ <b>${escTg(f.nome)}</b> não tem nenhuma parcela em aberto na Vobi.

` +
      `Pode já estar baixada, ser de outro fornecedor — ou ainda não ter sido lançada.`,
      inline([
        [{ text: "➕ Cadastrar como lançamento novo", callback_data: `fbnovo:${token}` }],
        [{ text: "🔄 É de outro fornecedor", callback_data: `fbtrocaforn:${token}` }],
        [{ text: "❌ Cancelar", callback_data: `fbnao:${token}` }],
      ]));
    return;
  }

  estado.candidatas = cands;
  estado.etapa = "esc_parcela";
  await salvarEstado(db, token, estado);

  // com lote possível NÃO decide sozinho: ela precisa ver as duas opções
  if (!combos.length && (cands.length === 1 || (cands[0].exata && !cands[1]?.exata))) {
    return await escolherParcela(db, B, token, estado, chatId, cands[0]);
  }

  const botoesLote = (estado.lotes || []).map((l, i) => [{
    text: `📦 As ${l.length} juntas: ${l.map((x) => brl(x.valor)).join(" + ")}`.slice(0, 60),
    callback_data: `fblote:${token}:${i}`,
  }]);

  const botoes = cands.map((c, i) => {
    const atraso = c.diasAtraso > 0 ? ` (${c.diasAtraso}d atraso)` : "";
    // o ID da parcela vai no botão (não o índice da lista): se alguém tocar num
    // botão de uma lista ANTIGA, o índice apontaria para outra conta
    return [{ text: `${dataBR(c.vencimento).slice(0, 5)} · ${brl(c.valor)}${atraso}`.slice(0, 60), callback_data: `fbparc:${token}:${c.id}` }];
  });
  // SEM SAIDA nao pode: a lista mostra so as 6 mais provaveis, e o fornecedor
  // pode ate ser o errado (o comprovante traz apelido). Antes so havia
  // "Cancelar" — quem nao reconhecia nenhum vencimento perdia o comprovante.
  botoes.unshift(...botoesLote);
  botoes.push([{ text: "🤷 Não é nenhum desses", callback_data: `fbmais:${token}` }]);
  botoes.push([{ text: "❌ Cancelar", callback_data: `fbnao:${token}` }]);

  const linhas = cands.map((c, i) => {
    const marca = c.exata ? " ✅ valor exato" : c.diferenca > 0 ? ` (+${brl(c.diferenca)})` : "";
    const atraso = c.diasAtraso > 0 ? ` · ${c.diasAtraso}d atraso` : "";
    return `${i + 1}. <b>${dataBR(c.vencimento)}</b> — ${brl(c.valor)}${marca}${atraso}\n    <i>${escTg(c.descricao.slice(0, 45))}</i>`;
  }).join("\n");

  const avisoLote = estado.lotes?.length
    ? `

💡 <i>Esse valor é exatamente a soma de ${estado.lotes[0].length} parcelas — ` +
      `se o pagamento quitou todas, use o botão 📦 lá em cima.</i>`
    : "";

  await enviar(B, chatId,
    `📋 <b>${escTg(f.nome)}</b> — pagamento de ${brl(estado.valorPago)}.
` +
    `A qual vencimento se refere?${avisoLote}

${linhas}`,
    inline(botoes));
}

/** Escolhida a parcela, pergunta COMO foi pago (a regra muda no cartão). */
async function escolherParcela(db: any, B: Bot, token: string, estado: EstadoBaixa, chatId: number, c: Candidata) {
  // TROCOU de parcela? O que ela respondeu sobre a diferença valia para a conta
  // ANTERIOR. Carregar aquilo para cá gravaria o valor de uma conta na outra —
  // é obrigatório perguntar de novo. (Reescolher a MESMA parcela não repergunta.)
  if (estado.parcela && estado.parcela.id !== c.id) {
    estado.valorConta = undefined;
    estado.juros = undefined;
    estado.valorContaCartao = undefined;
    estado.jurosCartao = undefined;
  }
  estado.parcela = { id: c.id, descricao: c.descricao, valor: c.valor, vencimento: c.vencimento, fornecedor: c.fornecedor };
  // o comprovante já disse como foi pago (ex.: "Forma de pagamento: Cartão de
  // crédito") — não faz sentido perguntar de novo. Ela pode corrigir em Alterar.
  if (estado.formaDoComprovante) {
    return await aplicarForma(db, B, token, estado, chatId, estado.forma);
  }
  return await perguntarForma(db, B, token, estado, chatId);
}

/** "Como foi pago?" — a regra muda no cartão, então isso decide o resto do fluxo. */
async function perguntarForma(db: any, B: Bot, token: string, estado: EstadoBaixa, chatId: number) {
  const p = estado.parcela!;
  estado.etapa = "esc_forma";
  await salvarEstado(db, token, estado);
  await enviar(B, chatId,
    `Como foi pago?\n<i>${escTg(p.descricao.slice(0, 40))} — venc. ${dataBR(p.vencimento)}</i>`,
    inline([
      [
        { text: "💠 PIX", callback_data: `fbforma:${token}:1` },
        { text: "🧾 Boleto", callback_data: `fbforma:${token}:2` },
      ],
      [
        { text: "💳 Cartão de crédito", callback_data: `fbforma:${token}:3` },
        { text: "🏦 Débito em conta", callback_data: `fbforma:${token}:9` },
      ],
      [{ text: "❌ Cancelar", callback_data: `fbnao:${token}` }],
    ]));
}

// ───────────────────────────── resumos ─────────────────────────────

function resumoBaixa(e: EstadoBaixa): string {
  const p = e.parcela!;
  const valorConta = contaDe(e);
  const juros = jurosDe(e);
  const desconto = descontoDe(e);
  const contaNome = nomeDaConta(e.conta);
  const formaNome = FORMAS_PAGAMENTO.find((f) => f.id === e.forma)?.nome || "—";
  const d = Math.round((Date.parse(e.dataPagamento) - Date.parse(p.vencimento)) / 86400000);
  const atraso = d > 0 ? ` · <b>${d} dia(s) de atraso</b>` : "";

  let txt = `💰 <b>Confirmar a baixa?</b>\n\n`;
  txt += `<b>Fornecedor:</b> ${escTg(p.fornecedor || "—")}\n`;
  txt += `<b>Conta:</b> ${escTg(p.descricao.slice(0, 50))}\n`;
  txt += `<b>Vencimento:</b> ${dataBR(p.vencimento)}${atraso}\n`;
  txt += Math.abs(valorConta - p.valor) >= 0.01
    ? `<b>Valor da conta:</b> ${brl(p.valor)} → <b>${brl(valorConta)}</b> <i>(corrigido)</i>\n`
    : `<b>Valor da conta:</b> ${brl(valorConta)}\n`;
  if (juros > 0) txt += `<b>Juros/multa:</b> ${brl(juros)} ⚠️\n`;
  if (desconto > 0) txt += `<b>Desconto:</b> ${brl(desconto)}\n`;
  txt += `<b>Valor pago:</b> ${brl(e.valorPago)}\n`;
  txt += `<b>Pago em:</b> ${dataBR(e.dataPagamento)}\n`;
  // Quando a conta é só o padrão, avisa: foi assim que o acordo do Lysnor, pago
  // pelo Villela, acabou lançado no Santander sem ninguém perceber.
  const aviso = e.contaDoComprovante ? "" : " <i>(padrão — confira)</i>";
  txt += `<b>Saiu de:</b> ${escTg(contaNome)}${aviso} · ${escTg(formaNome)}\n`;
  return txt;
}

function resumoCartao(e: EstadoBaixa): string {
  const p = e.parcela!;
  const juros = jurosDe(e);
  const venc = e.vencimentoFatura || proximoVencimentoCartao();
  const valorConta = contaDe(e);
  const novoValor = Math.round((valorConta + juros) * 100) / 100;

  let txt = `💳 <b>Confirmar o pagamento no cartão?</b>\n\n`;
  txt += `<b>Fornecedor:</b> ${escTg(p.fornecedor || "—")}\n`;
  txt += `<b>Conta:</b> ${escTg(p.descricao.slice(0, 50))}\n`;
  txt += `<b>Cartão:</b> ${escTg(e.cartao?.nome || "—")}\n\n`;
  txt += `<b>Vencimento:</b> ${dataBR(p.vencimento)} → <b>${dataBR(venc)}</b> (fatura)\n`;
  if (Math.abs(valorConta - p.valor) >= 0.01) txt += `<b>Valor da conta:</b> ${brl(p.valor)} → <b>${brl(valorConta)}</b>\n<b>Total:</b> `;
  else txt += `<b>Valor:</b> `;
  txt += `${brl(valorConta)}`;
  if (juros > 0) txt += ` + ${brl(juros)} de juros = <b>${brl(novoValor)}</b>`;
  txt += `\n\n<i>O fornecedor já recebeu. A conta continua EM ABERTO como <b>cartão de crédito</b> — a baixa acontece quando a fatura for paga (a conta bancária não muda).</i>\n`;
  return txt;
}

/** Salva e mostra o resumo certo (baixa normal ou cartão) com [Sim][Não][Alterar]. */
async function irParaConfirmacao(db: any, B: Bot, token: string, estado: EstadoBaixa, chatId: number) {
  estado.etapa = "confirmar";
  await salvarEstado(db, token, estado);
  const txt = estado.forma === FORMA_CARTAO ? resumoCartao(estado) : resumoBaixa(estado);
  await enviar(B, chatId, txt, BOTOES_CONFIRMA(token));
}

/**
 * O pago não bate com o que está na Vobi — e o bot NÃO pode chutar.
 *
 * Pedido da Adriana (16/09/2026): a diferença tanto pode ser juros por atraso
 * quanto o próprio valor da conta ter mudado (a Enel é apuração de consumo, e
 * outras parcelas às vezes são revisadas). Presumir juros lança errado, então
 * aqui perguntamos antes de montar o resumo.
 */
async function perguntarDiferenca(db: any, B: Bot, token: string, estado: EstadoBaixa, chatId: number) {
  const p = estado.parcela!;
  const dif = Math.round((estado.valorPago - p.valor) * 100) / 100;
  const ehCartao = estado.forma === FORMA_CARTAO;
  estado.etapa = "esc_diferenca";
  await salvarEstado(db, token, estado);

  const cabecalho =
    `🤔 <b>O valor não bate com o da Vobi.</b>\n\n` +
    `<b>Na Vobi:</b> ${brl(p.valor)}\n` +
    `<b>${ehCartao ? "No cartão" : "Pago"}:</b> ${brl(estado.valorPago)}\n` +
    `<b>Diferença:</b> ${brl(Math.abs(dif))}\n\n`;

  if (dif > 0) {
    await enviar(B, chatId,
      cabecalho + `A conta <b>mudou de valor</b> (ex.: consumo de energia, revisão da parcela) ou a diferença é <b>${ehCartao ? "juros do cartão" : "juros/multa"}</b>?`,
      inline([
        [{ text: `🧾 A conta é ${brl(estado.valorPago)} mesmo`, callback_data: `fbdifv:${token}` }],
        [{ text: `📈 É ${ehCartao ? "juros do cartão" : "juros/multa"} de ${brl(dif)}`, callback_data: `fbdifj:${token}` }],
        [{ text: "✏️ Os dois — eu informo a conta", callback_data: `fbdifb:${token}` }],
        [{ text: "❌ Cancelar", callback_data: `fbnao:${token}` }],
      ]));
    return;
  }

  // pagou MENOS que o lançado: ou a conta baixou de valor, ou houve desconto.
  // No CARTÃO não existe desconto: o que vai para a fatura é o valor lançado,
  // então a única leitura fiel é a conta ter ficado menor.
  if (ehCartao) {
    await enviar(B, chatId,
      cabecalho + `No cartão o que vai para a fatura é o valor lançado. A conta ficou menor?`,
      inline([
        [{ text: `🧾 A conta ficou em ${brl(estado.valorPago)}`, callback_data: `fbdifv:${token}` }],
        [{ text: "✏️ Eu informo o valor da conta", callback_data: `fbdifb:${token}` }],
        [{ text: "❌ Cancelar", callback_data: `fbnao:${token}` }],
      ]));
    return;
  }

  await enviar(B, chatId,
    cabecalho + `A conta <b>mudou de valor</b> para menos, ou foi um <b>desconto</b> no pagamento?`,
    inline([
      [{ text: `🧾 A conta é ${brl(estado.valorPago)} mesmo`, callback_data: `fbdifv:${token}` }],
      [{ text: `🏷️ Foi desconto de ${brl(Math.abs(dif))}`, callback_data: `fbdifj:${token}` }],
      [{ text: "✏️ Os dois — eu informo a conta", callback_data: `fbdifb:${token}` }],
      [{ text: "❌ Cancelar", callback_data: `fbnao:${token}` }],
    ]));
}

/** Escolhida a forma (por botão ou lida do comprovante), segue o caminho dela. */
async function aplicarForma(db: any, B: Bot, token: string, estado: EstadoBaixa, chatId: number, forma: number) {
  estado.forma = forma;
  if (forma === FORMA_CARTAO) {
    // com um único cartão ativo, não faz sentido perguntar qual é
    if (CARTOES.length === 1) {
      return await entrarNoCartao(db, B, token, estado, chatId, CARTOES[0].id);
    }
    estado.etapa = "esc_cartao";
    await salvarEstado(db, token, estado);
    const botoes = CARTOES.map((c) => [{ text: "💳 " + c.nome, callback_data: `fbcartao:${token}:${c.id}` }]);
    botoes.push([{ text: "❌ Cancelar", callback_data: `fbnao:${token}` }]);
    await enviar(B, chatId, "Qual cartão?", inline(botoes));
    return;
  }
  // não é cartão → conta padrão. Se o pago não bate com a Vobi, PERGUNTA
  // antes: pode ser juros, ou a conta ter mudado de valor.
  // Só cai no padrão quando o comprovante não disse de onde saiu — senão
  // sobrescreveria a conta certa que já tinha sido lida.
  if (!estado.contaDoComprovante) estado.conta = CONTA_PADRAO;
  if (precisaResolverDiferenca(estado)) {
    return await perguntarDiferenca(db, B, token, estado, chatId);
  }
  return await irParaConfirmacao(db, B, token, estado, chatId);
}

/** Entrou no cartão: fixa o cartão e resolve a diferença antes de pedir juros. */
async function entrarNoCartao(db: any, B: Bot, token: string, estado: EstadoBaixa, chatId: number, idCartao: number) {
  estado.cartao = { id: idCartao, nome: CARTOES.find((c) => c.id === idCartao)?.nome || String(idCartao) };
  // a conta NÃO vira o cartão: a fatura sai do Santander (ver rolarParaCartao)
  estado.vencimentoFatura = proximoVencimentoCartao(); // sempre a fatura de agora
  if (precisaResolverDiferenca(estado)) {
    return await perguntarDiferenca(db, B, token, estado, chatId);
  }
  // o comprovante do cartão já separa juros e IOF — não precisa perguntar
  if (estado.juros != null) {
    return await irParaConfirmacao(db, B, token, estado, chatId);
  }
  return await pedirJurosCartao(db, B, token, estado, chatId);
}

/** Pergunta os juros do cartão (digitados ou lidos do print da fatura). */
async function pedirJurosCartao(db: any, B: Bot, token: string, estado: EstadoBaixa, chatId: number) {
  estado.vencimentoFatura = estado.vencimentoFatura || proximoVencimentoCartao();
  estado.etapa = "aguarda_juros";
  await salvarEstado(db, token, estado);
  await enviar(B, chatId,
    `💳 <b>${escTg(estado.cartao?.nome || "cartão")}</b> — a conta (${brl(contaDe(estado))}) vai para a fatura de <b>${dataBR(estado.vencimentoFatura)}</b>.\n\n` +
    `Quanto de <b>juros do cartão</b>?\nMande o valor (ex.: <code>35,90</code>), o <b>print da fatura</b>, ou toque em “sem juros”.`,
    inline([
      [{ text: "🚫 Sem juros", callback_data: `fbjuros0:${token}` }],
      [{ text: "❌ Cancelar", callback_data: `fbnao:${token}` }],
    ]));
}

// ─────────────────────── recebimento (lado receita) ───────────────────────
//
// Espelha a baixa de despesa, com três diferenças que vêm do negócio:
//  1. o outro lado é CLIENTE, não fornecedor;
//  2. o bot NUNCA pré-confirma o valor cheio — conferir quanto entrou de fato
//     é o motivo de a Adriana ter pedido isto ("verificar se não houve nenhum
//     desconto indevido");
//  3. a conta de entrada é PERGUNTADA. Assumir o Santander poria dinheiro na
//     conta errada toda vez que o cliente depositasse em outro banco.

/** Motivos de um cliente pagar menos, na ordem do que mais acontece. */
const MOTIVOS_A_MENOS: Array<{ cod: string; texto: string; baixa: boolean; rotulo: string }> = [
  { cod: "imp", texto: "🧾 Retenção de imposto", baixa: true, rotulo: "retenção de imposto na fonte" },
  { cod: "desc", texto: "🤝 Desconto combinado", baixa: true, rotulo: "desconto combinado" },
  { cod: "tar", texto: "🏦 Tarifa do banco", baixa: true, rotulo: "tarifa bancária" },
  { cod: "par", texto: "⏳ Pagou só uma parte", baixa: false, rotulo: "pagamento parcial" },
  { cod: "err", texto: "❗ Pagou errado", baixa: false, rotulo: "valor errado do cliente" },
];

/** Contas onde o dinheiro pode ter entrado (os bancos de verdade). */
async function perguntarContaEntrada(db: any, B: Bot, token: string, estado: EstadoBaixa, chatId: number) {
  estado.etapa = "rec_conta";
  await salvarEstado(db, token, estado);
  const linhas: any[] = [];
  for (let i = 0; i < CONTAS_TRANSFERENCIA.length; i += 2) {
    linhas.push(CONTAS_TRANSFERENCIA.slice(i, i + 2).map((c) => ({
      text: c.nome, callback_data: `fbrconta:${token}:${c.id}`,
    })));
  }
  linhas.push([{ text: "❌ Cancelar", callback_data: `fbnao:${token}` }]);
  await enviar(B, chatId, `<i>Em qual conta o dinheiro entrou?</i>`, inline(linhas));
}

/** Compara o que entrou com o que a receita valia e decide o próximo passo. */
async function conferirValorRecebido(db: any, B: Bot, token: string, estado: EstadoBaixa, chatId: number) {
  const p = estado.parcela!;
  const dif = Math.round((p.valor - estado.valorPago) * 100) / 100; // >0 = veio menos

  if (Math.abs(dif) < 0.005) return await perguntarContaEntrada(db, B, token, estado, chatId);

  if (dif < 0) {
    // entrou MAIS que a conta: juros/multa que o cliente pagou por atraso
    estado.juros = Math.abs(dif);
    await enviar(
      B, chatId,
      `📈 Entrou <b>${brl(Math.abs(dif))} a mais</b> que a conta (${brl(p.valor)}).\n` +
        `<i>Vou lançar como juros recebidos.</i>`,
    );
    return await perguntarContaEntrada(db, B, token, estado, chatId);
  }

  // entrou MENOS: é exatamente o que a Adriana quer flagrar
  const pct = ((dif / p.valor) * 100).toFixed(1).replace(".", ",");
  estado.etapa = "rec_motivo";
  await salvarEstado(db, token, estado);
  const botoes = MOTIVOS_A_MENOS.map((m) => [{ text: m.texto, callback_data: `fbrmot:${token}:${m.cod}` }]);
  botoes.push([{ text: "❌ Cancelar", callback_data: `fbnao:${token}` }]);
  await enviar(
    B, chatId,
    `⚠️ <b>Entrou ${brl(dif)} A MENOS</b> (${pct}% da conta).\n\n` +
      `<b>A receita era:</b> ${brl(p.valor)}\n<b>Entrou:</b> ${brl(estado.valorPago)}\n\n` +
      `<i>Por quê? Só dou baixa depois que você disser — diferença sem explicação é desconto indevido.</i>`,
    inline(botoes),
  );
}

/** Grava o recebimento na Vobi e confere relendo. */
async function executarRecebimento(db: any, B: Bot, token: string, estado: EstadoBaixa, chatId: number) {
  const p = estado.parcela!;

  // idempotência: o botão do lembrete de ontem continua clicável, e dois toques
  // reescreveriam a baixa (apagando o desconto/juros já gravados)
  const aberta = await parcelaEmAberto(p.id).catch(() => true); // na dúvida, segue
  if (!aberta) {
    await apagarEstado(db, token);
    await enviar(B, chatId, `✅ Essa receita já não está em aberto — alguém já deu baixa. Nada foi alterado.`);
    return;
  }

  await enviar(B, chatId, "⏳ Dando baixa no recebimento…");
  const desconto = Math.max(0, Math.round((p.valor - estado.valorPago) * 100) / 100);
  let r;
  try {
    r = await darBaixa({
      idInstallment: p.id,
      valorPago: estado.valorPago,
      // o valor que a RECEITA valia continua sendo o da Vobi: a diferença é
      // desconto/retenção, não mudança do valor da conta. Corrigir o valor aqui
      // apagaria a prova de que entrou menos.
      valorConta: p.valor,
      dataPagamento: estado.dataPagamento,
      idPaymentBankAccount: estado.conta,
      idPaymentType: estado.forma,
      juros: estado.juros ?? 0,
      desconto,
      observacao: estado.recMotivo ? `Recebido a menos: ${estado.recMotivo}.` : undefined,
    });
  } catch (e: any) {
    await enviar(B, chatId, "❌ Erro ao dar baixa: " + escTg(String(e?.message || e)) + "\n<i>Nada confirmado — confira na Vobi.</i>");
    return;
  }

  await apagarEstado(db, token);
  if (!r.ok) {
    await enviar(B, chatId, `⚠️ <b>NÃO consegui confirmar o recebimento.</b>\n${escTg(r.mensagem)}\n\n<i>Não considere recebido — confira na Vobi.</i>`);
    return;
  }

  let txt = `✅ <b>Recebimento lançado na Vobi!</b>\n\n`;
  txt += `${escTg(p.fornecedor || "")} — ${escTg(p.descricao.slice(0, 45))}\n`;
  txt += `Venc. ${dataBR(p.vencimento)} · <b>${brl(estado.valorPago)}</b> em ${dataBR(estado.dataPagamento)}\n`;
  txt += `Entrou em: ${escTg(nomeDaConta(estado.conta))}\n`;
  if (desconto > 0) txt += `\n⚠️ <b>${brl(desconto)} a menos</b> — ${escTg(estado.recMotivo || "sem motivo informado")}\n`;
  if ((estado.juros ?? 0) > 0) txt += `\n📈 ${brl(estado.juros!)} de juros recebidos\n`;
  txt += `\n<i>Lançado por ${escTg(estado.autor)}.</i>`;
  await enviar(B, chatId, txt);
}

// ───────────────────────── callbacks (botões) ─────────────────────────

export async function onCallbackFinanceiro(db: any, B: Bot, cq: any, chatId: number, data: string) {
  // "✅ Paguei" tocado no lembrete do dia: a parcela já é conhecida, então
  // pulamos a busca de fornecedor e a escolha de vencimento.
  if (data.startsWith("fbpago:")) {
    const idInst = data.slice("fbpago:".length);
    const p = await parcelaPorId(idInst).catch(() => null);
    if (!p) {
      await enviar(B, chatId, "Não encontrei essa conta em aberto — talvez já tenha sido baixada. 👍");
      return;
    }
    const tk = novoToken();
    const estado: EstadoBaixa = {
      chat_id: chatId,
      autor: `${cq.from?.first_name || ""} ${cq.from?.last_name || ""}`.trim() || "alguém",
      valorPago: p.valor,
      dataPagamento: hojeISO(),
      fornecedor: p.fornecedor ? { id: p.idFornecedor || 0, nome: p.fornecedor } : undefined,
      forma: FORMA_PADRAO,
      conta: CONTA_PADRAO,
      etapa: "esc_forma",
    };
    await salvarEstado(db, tk, estado);
    return await escolherParcela(db, B, tk, estado, chatId, {
      ...p, diferenca: 0, exata: true,
    } as Candidata);
  }

  // ── "📥 Recebi" no lembrete de receitas ──
  if (data.startsWith("fbrec:")) {
    const idInst = data.slice("fbrec:".length);
    const p = await parcelaPorId(idInst).catch(() => null);
    if (!p) {
      await enviar(B, chatId, "Não encontrei essa receita em aberto — talvez já tenha sido baixada. 👍");
      return;
    }
    const tk = novoToken();
    const estado: EstadoBaixa = {
      chat_id: chatId,
      autor: `${cq.from?.first_name || ""} ${cq.from?.last_name || ""}`.trim() || "alguém",
      valorPago: p.valor,
      dataPagamento: hojeISO(),
      forma: FORMA_PADRAO,
      conta: CONTA_PADRAO,
      tipo: "receita",
      parcela: { id: p.id, descricao: p.descricao, valor: p.valor, vencimento: p.vencimento, fornecedor: p.fornecedor },
      etapa: "rec_valor",
    };
    await salvarEstado(db, tk, estado);
    const atraso = p.diasAtraso > 0 ? ` · <i>${p.diasAtraso} dias em atraso</i>` : "";
    await enviar(
      B, chatId,
      `📥 <b>Recebimento</b>\n${escTg(p.fornecedor || "sem cliente")}\n` +
        `<i>${escTg(p.descricao.slice(0, 45))}</i>\n` +
        `Venc. ${dataBR(p.vencimento)}${atraso}\n<b>A receita é de ${brl(p.valor)}</b>\n\n` +
        `<i>Quanto entrou de verdade na conta?</i>`,
      inline([
        [{ text: `✅ Entrou ${brl(p.valor)} (valor cheio)`, callback_data: `fbrcheio:${tk}` }],
        [{ text: "✏️ Entrou outro valor", callback_data: `fbroutro:${tk}` }],
        [{ text: "❌ Cancelar", callback_data: `fbnao:${tk}` }],
      ]),
    );
    return;
  }

  const [acao, token, arg] = data.split(":");
  const estado = await lerEstado(db, token);
  if (!estado) {
    await enviar(B, chatId, "Esse lançamento já foi tratado ou expirou. Mande o valor e o fornecedor de novo. 👍");
    return;
  }

  // "🔄 Tentar de novo" depois de a Vobi recusar: retoma de onde parou, sem
  // pedir o comprovante de novo.
  // "Não é nenhum desses": a lista curta (6 mais prováveis) não serviu. Mostra
  // TODAS as contas em aberto do fornecedor e deixa trocar de fornecedor —
  // sem isto o único caminho era cancelar e mandar o comprovante de novo.
  if (acao === "fbmais") {
    const f = estado.fornecedor;
    if (!f) {
      estado.etapa = "aguarda_fornecedor";
      await salvarEstado(db, token, estado);
      await enviar(B, chatId, "Me diga o <b>nome do fornecedor</b> (pode ser só um pedaço).", BOTOES_CANCELA(token));
      return;
    }

    let todas: ParcelaAberta[];
    try {
      todas = await parcelasAbertasDoFornecedor(f.id, f.nome);
    } catch (e: any) {
      return await falhaDaVobi(db, B, token, estado, chatId, e, "listar as contas em aberto");
    }

    const jaVistas = new Set((estado.candidatas || []).map((c) => c.id));
    const restantes = todas.filter((p) => !jaVistas.has(p.id));

    const outroForn = [{ text: "🔄 É de outro fornecedor", callback_data: `fbtrocaforn:${token}` }];
    const porValor = [{ text: `🔎 Procurar contas de ${brl(estado.valorPago)}`, callback_data: `fbvalor:${token}` }];

    if (!restantes.length) {
      await enviar(B, chatId,
        `<b>${escTg(f.nome)}</b> não tem outra conta em aberto além das que já mostrei.\n\n` +
        `Então o pagamento é de <b>outro fornecedor</b> — ou a conta ainda não foi lançada na Vobi.`,
        inline([
          [{ text: "➕ Cadastrar como lançamento novo", callback_data: `fbnovo:${token}` }],
          outroForn, porValor, [{ text: "❌ Cancelar", callback_data: `fbnao:${token}` }],
        ]));
      return;
    }

    // as restantes viram as candidatas do estado: o botão fbparc procura o id aqui
    const comoCand = restantes.map((p) => ({
      ...p,
      diferenca: Math.round((estado.valorPago - p.valor) * 100) / 100,
      exata: Math.round(p.valor * 100) === Math.round(estado.valorPago * 100),
    })) as Candidata[];
    estado.candidatas = comoCand.slice(0, 12);
    estado.etapa = "esc_parcela";
    await salvarEstado(db, token, estado);

    const botoes = estado.candidatas.map((c) => [{
      text: `${dataBR(c.vencimento).slice(0, 5)} · ${brl(c.valor)}`.slice(0, 60),
      callback_data: `fbparc:${token}:${c.id}`,
    }]);
    botoes.push(outroForn, porValor, [{ text: "❌ Cancelar", callback_data: `fbnao:${token}` }]);

    const linhas = estado.candidatas.map((c, i) =>
      `${i + 1}. <b>${dataBR(c.vencimento)}</b> — ${brl(c.valor)}\n    <i>${escTg(c.descricao.slice(0, 45))}</i>`,
    ).join("\n");

    await enviar(B, chatId,
      `📋 <b>${escTg(f.nome)}</b> — outras contas em aberto` +
        (comoCand.length > 12 ? ` (as 12 primeiras de ${comoCand.length})` : "") +
        `:\n\n${linhas}`,
      inline(botoes));
    return;
  }

  // Trocar o fornecedor sem perder o que o comprovante já disse.
  if (acao === "fbtrocaforn") {
    estado.fornecedor = undefined;
    estado.candidatas = undefined;
    estado.parcela = undefined;
    estado.etapa = "aguarda_fornecedor";
    await salvarEstado(db, token, estado);
    await enviar(B, chatId,
      `Qual é o fornecedor de <b>${brl(estado.valorPago)}</b>?\n\n` +
      `<i>Escreva o nome (ou um pedaço dele) aqui no grupo.</i>`,
      BOTOES_CANCELA(token));
    return;
  }

  // ───────── PAGAMENTO AGRUPADO (uma transferência, várias parcelas) ─────────
  if (acao === "fblote") {
    const i = Number(arg);
    const lote = estado.lotes?.[i];
    if (!lote?.length) {
      await enviar(B, chatId, "Essa opção é de uma lista antiga. Mande o comprovante de novo.");
      return;
    }
    estado.loteEscolhido = i;
    estado.etapa = "lote_confirma";
    await salvarEstado(db, token, estado);

    const soma = lote.reduce((t, p) => t + p.valor, 0);
    const linhas = lote.map((p, k) =>
      `${k + 1}. <b>${dataBR(p.vencimento)}</b> — ${brl(p.valor)}\n    <i>${escTg(p.descricao.slice(0, 45))}</i>`,
    ).join("\n");

    await enviar(B, chatId,
      `📦 <b>Baixar ${lote.length} parcelas com esse pagamento</b>\n\n${linhas}\n\n` +
      `<b>Soma:</b> ${brl(soma)}\n<b>Pago:</b> ${brl(estado.valorPago)} em ${dataBR(estado.dataPagamento)}\n` +
      `<b>Conta:</b> ${escTg(nomeDaConta(estado.conta))}\n\n` +
      `<i>Cada parcela é baixada pelo valor dela — sem juros, porque a soma fecha exata.</i>`,
      inline([
        [{ text: `✅ Baixar as ${lote.length}`, callback_data: `fbloteok:${token}` }],
        [{ text: "⬅️ Ver as parcelas uma a uma", callback_data: `fbvolta:${token}` }],
        [{ text: "❌ Cancelar", callback_data: `fbnao:${token}` }],
      ]));
    return;
  }

  if (acao === "fbloteok") {
    const lote = estado.lotes?.[estado.loteEscolhido ?? -1];
    if (!lote?.length) { await enviar(B, chatId, "Não achei o lote. Mande o comprovante de novo."); return; }

    if (estado.etapa === "lote_gravando") {
      await enviar(B, chatId, "⏳ Já estou baixando essas — só um instante.");
      return;
    }
    estado.etapa = "lote_gravando";
    await salvarEstado(db, token, estado);
    await enviar(B, chatId, `⏳ Dando baixa nas ${lote.length} parcelas…`);

    // Uma a uma, cada qual pelo SEU valor. Se uma falhar, as outras já baixadas
    // continuam baixadas — por isso o relatório no fim diz exatamente quais.
    const ok: string[] = [];
    const falhou: string[] = [];
    for (const p of lote) {
      try {
        const r = await darBaixa({
          idInstallment: p.id,
          valorPago: p.valor,
          valorConta: p.valor, // soma exata => nao ha juros para distribuir
          dataPagamento: estado.dataPagamento,
          idPaymentBankAccount: estado.conta,
          idPaymentType: estado.forma,
        });
        if (r.ok) ok.push(`${dataBR(p.vencimento)} · ${brl(p.valor)}`);
        else falhou.push(`${dataBR(p.vencimento)} · ${brl(p.valor)} — ${r.mensagem}`);
      } catch (e: any) {
        falhou.push(`${dataBR(p.vencimento)} · ${brl(p.valor)} — ${String(e?.message || e).slice(0, 90)}`);
      }
    }

    await apagarEstado(db, token);
    let txt = falhou.length
      ? `⚠️ <b>Baixei ${ok.length} de ${lote.length}.</b>\n`
      : `✅ <b>Baixadas as ${ok.length} parcelas!</b>\n`;
    if (ok.length) txt += `\n${ok.map((x) => `✅ ${escTg(x)}`).join("\n")}\n`;
    if (falhou.length) {
      txt += `\n${falhou.map((x) => `❌ ${escTg(x)}`).join("\n")}\n\n` +
             `<i>As que falharam continuam em aberto — confira na Vobi.</i>`;
    } else {
      txt += `\n<b>${escTg(estado.fornecedor?.nome || "")}</b> — total ${brl(lote.reduce((t, p) => t + p.valor, 0))}`;
    }
    await enviar(B, chatId, txt);
    return;
  }

  // ───────── botoes do fluxo de NOVO LANCAMENTO ─────────
  if (acao === "fbnovo") {
    // veio de um beco sem saida da baixa: reaproveita valor/data ja lidos
    return await iniciarNovoLancamento(db, B, chatId, estado.autor, {
      valor: estado.valorPago, data: estado.dataPagamento,
      forma: estado.forma, estabelecimento: estado.nomeBusca || estado.fornecedor?.nome,
    }, token);
  }

  if (acao === "fbnfor") {
    const id = Number(arg);
    const f = (await fornecedores().catch(() => [])).find((x) => x.id === id);
    estado.novo!.idSupplier = id;
    estado.novo!.fornecedorNome = f ? (f.nome || f.razao) : `fornecedor ${id}`;
    return await proximoPassoNovo(db, B, token, estado, chatId);
  }

  if (acao === "fbnforcriar") {
    const termo = (estado.novo?.buscaForn || estado.novo?.nome || "").trim();
    try {
      const f = await criarFornecedor(termo);
      estado.novo!.idSupplier = f.id;
      estado.novo!.fornecedorNome = f.nome;
      await enviar(B, chatId, `✅ Fornecedor <b>${escTg(f.nome)}</b> cadastrado na Vobi.`);
    } catch (e: any) {
      await enviar(B, chatId, `❌ Não consegui criar o fornecedor: ${escTg(String(e?.message || e).slice(0, 160))}`);
      return await pedirFornecedorNovo(db, B, token, estado, chatId);
    }
    return await proximoPassoNovo(db, B, token, estado, chatId);
  }

  if (acao === "fbnforbusca") {
    estado.etapa = "novo_busca_forn";
    await salvarEstado(db, token, estado);
    await enviar(B, chatId, "👤 Escreva o <b>nome do fornecedor</b> (ou um pedaço).", BOTOES_CANCELA(token));
    return;
  }

  if (acao === "fbncat") {
    const id = Number(arg);
    const c = (await categoriasFinanceiras().catch(() => [])).find((x) => x.id === id);
    estado.novo!.idCategoria = id;
    estado.novo!.categoriaNome = c ? c.nome.trim() : `categoria ${id}`;
    return await proximoPassoNovo(db, B, token, estado, chatId);
  }

  if (acao === "fbncatbusca") {
    estado.etapa = "novo_busca_cat";
    await salvarEstado(db, token, estado);
    await enviar(B, chatId, "🗂 Escreva um pedaço do nome da <b>categoria</b>.", BOTOES_CANCELA(token));
    return;
  }

  if (acao === "fbncc") {
    const id = Number(arg);
    const c = (await centrosDeCusto().catch(() => [])).find((x) => x.id === id);
    estado.novo!.idCentroCusto = id;
    estado.novo!.ccNome = c ? c.nome.trim() : `centro ${id}`;
    return await proximoPassoNovo(db, B, token, estado, chatId);
  }

  if (acao === "fbnccbusca") {
    estado.etapa = "novo_busca_cc";
    await salvarEstado(db, token, estado);
    await enviar(B, chatId, "🏗 Escreva um pedaço do <b>centro de custo</b>.", BOTOES_CANCELA(token));
    return;
  }

  if (acao === "fbnconta") {
    const id = Number(arg);
    estado.novo!.conta = id;
    // cartao de credito manda na forma; conta corrente mantem o que veio do comprovante
    if (CARTOES.some((c) => c.id === id)) estado.novo!.forma = FORMA_CARTAO;
    return await proximoPassoNovo(db, B, token, estado, chatId);
  }

  if (acao === "fbncontatroca") {
    return await pedirContaNovo(db, B, token, estado, chatId);
  }

  if (acao === "fbnpago") {
    estado.novo!.pago = arg === "1";
    if (!estado.novo!.pago) {
      estado.etapa = "novo_venc";
      await salvarEstado(db, token, estado);
      await enviar(B, chatId,
        `📅 <b>Quando vence?</b>\nEscreva a data — <code>05/10</code> ou <code>05/10/2026</code>.`,
        BOTOES_CANCELA(token));
      return;
    }
    return await proximoPassoNovo(db, B, token, estado, chatId);
  }

  if (acao === "fbnok") {
    return await gravarNovoLancamento(db, B, token, estado, chatId);
  }

  if (acao === "fbretry") {
    // Num estado de transferência, "tentar de novo" NÃO pode virar busca de
    // fornecedor (o nome está vazio) — retoma a transferência de onde parou.
    if (String(estado.etapa || "").startsWith("transf_")) {
      if (estado.transfOrigem && estado.transfDestino) {
        return await onCallbackFinanceiro(db, B, cq, chatId, `fbtretry:${token}`);
      }
      const lado = estado.transfOrigem ? "destino" : "origem";
      estado.etapa = lado === "origem" ? "transf_origem" : "transf_destino";
      await salvarEstado(db, token, estado);
      return await pedirContaTransf(B, token, estado, chatId, lado, true);
    }
    if (estado.fornecedor) return await mostrarParcelas(db, B, token, estado, chatId);
    await enviar(B, chatId, `🔎 Procurando <b>${escTg(estado.nomeBusca || "")}</b> — ${brl(estado.valorPago)}…`);
    return await buscarFornecedorEContinuar(db, B, token, estado, chatId);
  }

  // ── "não é nenhum desses": procura pelo VALOR, em qualquer fornecedor ──
  // ── transferência entre contas próprias: de onde saiu ──
  // ── recebimento: entrou o valor cheio ──
  if (acao === "fbrcheio") {
    estado.valorPago = estado.parcela!.valor;
    estado.juros = 0;
    await salvarEstado(db, token, estado);
    return await perguntarContaEntrada(db, B, token, estado, chatId);
  }

  // ── recebimento: vou digitar quanto entrou ──
  if (acao === "fbroutro") {
    estado.etapa = "rec_aguarda_valor";
    await salvarEstado(db, token, estado);
    await enviar(B, chatId, `Quanto entrou na conta? <i>(só o número, ex.: ${brl(estado.parcela!.valor).replace("R$ ", "")})</i>`, BOTOES_CANCELA(token));
    return;
  }

  // ── recebimento: por que veio menos ──
  if (acao === "fbrmot") {
    const m = MOTIVOS_A_MENOS.find((x) => x.cod === arg);
    if (!m) { await enviar(B, chatId, "Não entendi o motivo. Toque de novo."); return; }
    estado.recMotivo = m.rotulo;
    await salvarEstado(db, token, estado);
    if (!m.baixa) {
      // Decisão da Adriana: em pagamento parcial (ou erro do cliente) o bot NÃO
      // mexe na parcela. Dividir um recebível na Vobi reescreve o lançamento
      // inteiro e troca os IDs, inclusive das parcelas irmãs do mesmo contrato.
      const p = estado.parcela!;
      const falta = Math.round((p.valor - estado.valorPago) * 100) / 100;
      await apagarEstado(db, token);
      await enviar(
        B, chatId,
        `⏳ <b>Não dei baixa</b> — ${escTg(m.rotulo)}.\n\n` +
          `${escTg(p.fornecedor || "")} — ${escTg(p.descricao.slice(0, 40))}\n` +
          `<b>A receita é:</b> ${brl(p.valor)}\n<b>Entrou:</b> ${brl(estado.valorPago)}\n` +
          `<b>Falta:</b> ${brl(falta)}\n\n` +
          `<i>A receita segue em aberto pelo valor cheio. Ajuste na Vobi como preferir — ` +
          `partir a parcela por aqui reescreveria o lançamento e trocaria os IDs.</i>`,
      );
      return;
    }
    return await perguntarContaEntrada(db, B, token, estado, chatId);
  }

  // ── recebimento: em qual conta entrou (e grava) ──
  if (acao === "fbrconta") {
    if (estado.etapa === "rec_gravando") {
      await enviar(B, chatId, "⏳ Já estou lançando esse recebimento — só um instante.");
      return;
    }
    estado.conta = Number(arg);
    estado.etapa = "rec_gravando";
    await salvarEstado(db, token, estado);
    return await executarRecebimento(db, B, token, estado, chatId);
  }

  // ── "o que é este comprovante?": as três saídas da tela de dúvida ──
  if (acao === "fbdesp") {
    estado.tipo = "despesa";
    await salvarEstado(db, token, estado);
    // O comprovante do Banco Villela não traz nome nenhum — e é de lá que sai
    // boa parte dos pagamentos. Sem nome para procurar, o que liga é o VALOR;
    // pedir para digitar o fornecedor seria trabalho à toa.
    if (!estado.nomeBusca) {
      return await onCallbackFinanceiro(db, B, cq, chatId, `fbvalor:${token}`);
    }
    await enviar(B, chatId, `🔎 Procurando <b>${escTg(estado.nomeBusca)}</b> — ${brl(estado.valorPago)}…`);
    return await buscarFornecedorEContinuar(db, B, token, estado, chatId);
  }

  if (acao === "fbreceb") {
    await apagarEstado(db, token);
    return await iniciarRecebimento(
      db, B, chatId, estado.autor, estado.valorPago,
      estado.nomeBusca || "", estado.dataPagamento, estado.transfBancoDestino,
    );
  }

  if (acao === "fbtransf") {
    estado.etapa = "transf_origem";
    estado.forma = 5;
    await salvarEstado(db, token, estado);
    return await pedirContaTransf(B, token, estado, chatId, "origem", true);
  }

  // ── recebimento: a pessoa escolheu qual receita ──
  if (acao === "fbrecp") {
    let p;
    try {
      p = (await receitasAbertas()).find((x) => x.id === arg);
    } catch (e: any) {
      return await falhaDaVobi(db, B, token, estado, chatId, e, "abrir a receita");
    }
    if (!p) { await enviar(B, chatId, "Essa receita não está mais em aberto."); return; }
    return await abrirRecebimento(db, B, token, estado, chatId, p);
  }

  // ── recebimento: confirma o valor que veio do comprovante ──
  if (acao === "fbrconf") {
    await salvarEstado(db, token, estado);
    return await conferirValorRecebido(db, B, token, estado, chatId);
  }

  // ── trocar a conta de onde o dinheiro saiu ──
  if (acao === "fbaltb") {
    estado.etapa = "esc_conta";
    await salvarEstado(db, token, estado);
    const linhas: any[] = [];
    for (let i = 0; i < CONTAS_TRANSFERENCIA.length; i += 2) {
      linhas.push(CONTAS_TRANSFERENCIA.slice(i, i + 2).map((c) => ({
        text: (c.id === estado.conta ? "• " : "") + c.nome,
        callback_data: `fbconta:${token}:${c.id}`,
      })));
    }
    linhas.push([{ text: "⬅️ Voltar", callback_data: `fbvolta:${token}` }]);
    await enviar(B, chatId, "🏦 <i>De qual conta o dinheiro saiu?</i>", inline(linhas));
    return;
  }

  if (acao === "fbconta") {
    estado.conta = Number(arg);
    estado.contaDoComprovante = true; // escolha explícita vence o padrão
    await salvarEstado(db, token, estado);
    return await irParaConfirmacao(db, B, token, estado, chatId);
  }

  if (acao === "fbtde") {
    if (estado.etapa === "transf_gravando") {
      await enviar(B, chatId, "⏳ Já estou lançando essa transferência — só um instante.");
      return;
    }
    estado.transfOrigem = Number(arg);
    estado.etapa = "transf_destino";
    await salvarEstado(db, token, estado);
    return await pedirContaTransf(B, token, estado, chatId, "destino");
  }

  // ── ...e para onde foi: grava as DUAS pontas ──
  if (acao === "fbtpara" || acao === "fbtretry") {
    // TRAVA: dois toques no botão (ou duas pessoas no grupo ao mesmo tempo)
    // lançariam a transferência DUAS VEZES — dinheiro em dobro na Vobi. Mesmo
    // padrão do "✅ Sim" da baixa.
    if (estado.etapa === "transf_gravando") {
      await enviar(B, chatId, "⏳ Já estou lançando essa transferência — só um instante.");
      return;
    }
    if (acao === "fbtpara") estado.transfDestino = Number(arg);
    if (!estado.transfOrigem || !estado.transfDestino) {
      await enviar(B, chatId, "Faltou escolher as contas. Mande o comprovante de novo. 👍");
      return;
    }
    estado.etapa = "transf_gravando";
    await salvarEstado(db, token, estado);

    const de = nomeDaConta(estado.transfOrigem);
    const para = nomeDaConta(estado.transfDestino);
    const retomando = !!estado.transfIdSaida;
    await enviar(
      B, chatId,
      retomando
        ? `🔁 Retomando: a saída de <b>${escTg(de)}</b> já está gravada, falta a entrada em <b>${escTg(para)}</b>…`
        : `🔁 Lançando ${brl(estado.valorPago)}: <b>${escTg(de)}</b> → <b>${escTg(para)}</b>…`,
    );

    const r: any = await criarTransferenciaEntreContas({
      origem: estado.transfOrigem,
      destino: estado.transfDestino,
      valor: estado.valorPago,
      data: estado.dataPagamento,
      autor: estado.autor,
      idSaidaExistente: estado.transfIdSaida,
    }).catch((e: any) => ({ ok: false, erro: String(e?.message || e) }));

    if (!r.ok) {
      // Meia transferência é pior que nenhuma: o dinheiro sai de uma conta e não
      // entra na outra. Guardamos o id da saída para que "tentar de novo" grave
      // SÓ a entrada que falta — nunca a saída outra vez.
      estado.transfIdSaida = r.idSaida;
      estado.etapa = r.idSaida ? "transf_meia" : "transf_falhou";
      await salvarEstado(db, token, estado);
      const meia = r.idSaida
        ? `\n\n⚠️ <b>A saída de ${escTg(de)} foi gravada; a entrada em ${escTg(para)} não.</b>\n` +
          `Enquanto ficar assim, o dinheiro some do caixa. Toque em <b>Tentar de novo</b> — ` +
          `eu gravo só a entrada que falta, sem repetir a saída.`
        : "";
      await enviar(
        B, chatId,
        `❌ Não consegui lançar a transferência.\n<i>${escTg(String(r.erro || "").slice(0, 200))}</i>${meia}`,
        inline([
          [{ text: "🔄 Tentar de novo", callback_data: `fbtretry:${token}` }],
          [{ text: "❌ Encerrar", callback_data: `fbnao:${token}` }],
        ]),
      );
      return;
    }

    await apagarEstado(db, token);
    await enviar(B, chatId,
      `✅ <b>Transferência lançada</b>\n${brl(estado.valorPago)} · ${dataBR(estado.dataPagamento)}\n` +
      `<b>Saiu de:</b> ${escTg(de)}\n<b>Entrou em:</b> ${escTg(para)}\n\n` +
      `<i>As duas pontas foram gravadas, então o saldo das duas contas já está certo.</i>`);
    return;
  }

  if (acao === "fbvalor") {
    let achadas: ParcelaAberta[];
    try {
      achadas = await parcelasAbertasPorValor(estado.valorPago, 8);
    } catch (e: any) {
      return await falhaDaVobi(db, B, token, estado, chatId, e, "procurar pelo valor");
    }
    if (!achadas.length) {
      await enviar(
        B,
        chatId,
        `❌ Não achei nenhuma conta em aberto de <b>${brl(estado.valorPago)}</b>.\n\n<i>Pode ser que a conta ainda não esteja lançada, ou que o valor pago seja diferente do valor da conta (juros, desconto). Lance na Vobi e me mande o comprovante de novo.</i>`,
      );
      return;
    }
    // Candidata = ParcelaAberta + a diferenca para o valor pago (juros/desconto)
    estado.candidatas = achadas.map((c) => ({
      ...c,
      diferenca: Math.round((estado.valorPago - c.valor) * 100) / 100,
      exata: Math.round(c.valor * 100) === Math.round(estado.valorPago * 100),
    }));
    estado.etapa = "esc_parcela";
    await salvarEstado(db, token, estado);
    const linhas = achadas.map((c, i) => {
      const quem = c.fornecedor ? escTg(c.fornecedor) : "<i>sem fornecedor</i>";
      const atraso = c.diasAtraso > 0 ? ` · ${c.diasAtraso}d em atraso` : "";
      return `${i + 1}. <b>${dataBR(c.vencimento)}</b> — ${brl(c.valor)}${atraso}\n    ${quem}\n    <i>${escTg(c.descricao.slice(0, 44))}</i>`;
    }).join("\n");
    const bts = achadas.map((c) => [{
      text: `${dataBR(c.vencimento).slice(0, 5)} · ${brl(c.valor)} · ${(c.fornecedor || c.descricao).slice(0, 22)}`.slice(0, 60),
      callback_data: `fbparc:${token}:${c.id}`,
    }]);
    bts.push([{ text: "❌ Cancelar", callback_data: `fbnao:${token}` }]);
    await enviar(
      B,
      chatId,
      `🔎 Contas em aberto de <b>${brl(estado.valorPago)}</b>, de qualquer fornecedor:\n\n${linhas}\n\n<i>Qual delas?</i>`,
      inline(bts),
    );
    return;
  }

  if (acao === "fbforn") {
    const id = Number(arg);
    const f = (await fornecedores()).find((x) => x.id === id);
    estado.fornecedor = { id, nome: f ? f.nome || f.razao : `fornecedor ${id}` };
    await salvarEstado(db, token, estado);
    return await mostrarParcelas(db, B, token, estado, chatId);
  }

  if (acao === "fbparc") {
    const c = (estado.candidatas || []).find((x) => x.id === arg);
    if (!c) { await enviar(B, chatId, "Essa opção é de uma lista antiga. Toque em <b>Alterar → Vencimento</b> para ver a lista atual."); return; }
    return await escolherParcela(db, B, token, estado, chatId, c);
  }

  // ── forma de pagamento escolhida ──
  if (acao === "fbforma") {
    return await aplicarForma(db, B, token, estado, chatId, Number(arg));
  }

  // ── cartão escolhido ──
  if (acao === "fbcartao") {
    return await entrarNoCartao(db, B, token, estado, chatId, Number(arg));
  }

  // ── a diferença é o VALOR DA CONTA (não é juros) ──
  if (acao === "fbdifv") {
    estado.valorConta = estado.valorPago;
    if (estado.forma === FORMA_CARTAO) {
      // a conta foi corrigida, mas o cartão ainda pode ter juros próprios
      return await pedirJurosCartao(db, B, token, estado, chatId);
    }
    estado.juros = 0;
    return await irParaConfirmacao(db, B, token, estado, chatId);
  }

  // ── a diferença é JUROS/MULTA (ou desconto, se pagou menos) ──
  if (acao === "fbdifj") {
    estado.valorConta = estado.parcela?.valor ?? estado.valorPago;
    if (estado.forma === FORMA_CARTAO) {
      estado.juros = Math.max(0, Math.round((estado.valorPago - estado.valorConta) * 100) / 100);
    } else {
      estado.juros = undefined; // deixa derivar (juros OU desconto) do valor da conta
    }
    return await irParaConfirmacao(db, B, token, estado, chatId);
  }

  // ── os dois: ela digita o valor da conta e o resto vira juros ──
  if (acao === "fbdifb") {
    estado.etapa = "aguarda_conta_resto";
    await salvarEstado(db, token, estado);
    await enviar(B, chatId,
      `🧾 Qual o <b>valor da conta</b> (sem os juros)?\n` +
      `<i>(na Vobi está ${brl(estado.parcela?.valor ?? 0)} e foi pago ${brl(estado.valorPago)} — o que sobrar eu lanço como ` +
      `${estado.forma === FORMA_CARTAO ? "juros do cartão" : "juros/multa, ou como desconto se a conta for maior que o pago"})</i>`,
      BOTOES_CANCELA(token));
    return;
  }

  if (acao === "fbjuros0") {
    estado.juros = 0;
    return await irParaConfirmacao(db, B, token, estado, chatId);
  }

  if (acao === "fbnao") {
    await apagarEstado(db, token);
    await enviar(B, chatId, "❌ Cancelado. Nada foi alterado na Vobi.");
    return;
  }

  if (acao === "fbalt") {
    estado.etapa = "alterar";
    await salvarEstado(db, token, estado);
    // no cartão são DUAS coisas diferentes: o valor da conta (ex.: energia, que
    // muda todo mês pelo consumo) e os juros do cartão
    const opcoes = estado.forma === FORMA_CARTAO
      ? [
          [{ text: "🧾 Valor da conta", callback_data: `fbaltc:${token}` }],
          [{ text: "💳 Juros do cartão", callback_data: `fbaltj:${token}` }],
          [{ text: "📅 Vencimento", callback_data: `fbaltd:${token}` }],
          [{ text: "🔁 Não foi no cartão", callback_data: `fbaltf:${token}` }],
          [{ text: "⬅️ Voltar", callback_data: `fbvolta:${token}` }],
        ]
      : [
          // "valor pago" (o que saiu da conta) e "valor da conta" (o que era
          // devido) são coisas diferentes — a diferença entre eles é o juros
          [
            { text: "💵 Valor pago", callback_data: `fbaltv:${token}` },
            { text: "🧾 Valor da conta", callback_data: `fbaltc:${token}` },
          ],
          [
            { text: "📈 Juros/multa", callback_data: `fbaltj:${token}` },
            { text: "📅 Vencimento", callback_data: `fbaltd:${token}` },
          ],
          [
            { text: "🔁 Forma de pagamento", callback_data: `fbaltf:${token}` },
            { text: "🏦 Conta de onde saiu", callback_data: `fbaltb:${token}` },
          ],
          [{ text: "⬅️ Voltar", callback_data: `fbvolta:${token}` }],
        ];
    await enviar(B, chatId, "✏️ O que você quer alterar?", inline(opcoes));
    return;
  }

  // VALOR PAGO — o que saiu da conta. Muda o pago, então a diferença volta a
  // ser uma incógnita: zeramos o que foi resolvido para perguntar de novo.
  if (acao === "fbaltv") {
    estado.etapa = "aguarda_valor";
    await salvarEstado(db, token, estado);
    await enviar(B, chatId,
      `💵 Qual foi o <b>valor pago</b> de verdade?\n<i>(hoje está ${brl(estado.valorPago)} — mande só o número)</i>`,
      BOTOES_CANCELA(token));
    return;
  }

  // VALOR DA CONTA — o que era devido (energia por consumo, parcela revisada…)
  if (acao === "fbaltc") {
    estado.etapa = "aguarda_valor_conta";
    await salvarEstado(db, token, estado);
    await enviar(B, chatId,
      `🧾 Qual o <b>valor da conta</b> (o que era devido, sem os juros)?\n<i>(hoje está ${brl(contaDe(estado))}; na Vobi está ${brl(estado.parcela?.valor ?? 0)})</i>`,
      BOTOES_CANCELA(token));
    return;
  }

  // JUROS — do cartão, ou juros/multa por atraso
  if (acao === "fbaltj") {
    estado.etapa = "aguarda_juros";
    await salvarEstado(db, token, estado);
    const rotulo = estado.forma === FORMA_CARTAO ? "juros do cartão" : "juros/multa";
    const nota = estado.forma === FORMA_CARTAO
      ? ""
      : `\n<i>O valor da conta vira ${brl(estado.valorPago)} menos os juros.</i>`;
    await enviar(B, chatId,
      `📈 Qual o valor dos <b>${rotulo}</b>?\n<i>(hoje está ${brl(jurosDe(estado))})</i>${nota}\nPode mandar o número ou o <b>print</b>.`,
      BOTOES_CANCELA(token));
    return;
  }

  // trocar a FORMA (tocou no cartão sem querer, por exemplo). O juros do cartão
  // deixa de valer, então volta a ser incógnita; o valor da conta continua.
  if (acao === "fbaltf") {
    if (!estado.parcela) return await mostrarParcelas(db, B, token, estado, chatId);
    estado.juros = undefined;
    estado.jurosCartao = undefined;
    estado.cartao = undefined;
    estado.vencimentoFatura = undefined;
    return await perguntarForma(db, B, token, estado, chatId);
  }

  if (acao === "fbaltd") {
    // sem o id do fornecedor não dá para listar os outros vencimentos — e seguir
    // adiante apagaria o lançamento com a mensagem errada ("não tem parcela em
    // aberto"). Acontece em lançamento antigo vindo do botão "Paguei".
    if (!estado.fornecedor?.id) {
      await enviar(B, chatId,
        "Para trocar o vencimento eu preciso reabrir a lista do fornecedor.\n" +
        `Mande <code>${estado.valorPago} ${escTg((estado.fornecedor?.nome || "nome do fornecedor").slice(0, 30))}</code> que eu mostro todos os vencimentos em aberto.`,
        BOTOES_CONFIRMA(token));
      return;
    }
    return await mostrarParcelas(db, B, token, estado, chatId);
  }

  if (acao === "fbvolta") {
    if (!estado.parcela) return await mostrarParcelas(db, B, token, estado, chatId);
    return await irParaConfirmacao(db, B, token, estado, chatId);
  }

  // ── SIM → executa ──
  if (acao === "fbsim") {
    if (!estado.parcela) { await enviar(B, chatId, "Faltou escolher a parcela."); return; }
    // dois toques no ✅ (ou duas pessoas ao mesmo tempo) não podem gravar duas vezes
    if (estado.etapa === "executando") {
      await enviar(B, chatId, "⏳ Já estou gravando esse lançamento — só um instante.");
      return;
    }
    estado.etapa = "executando";
    await salvarEstado(db, token, estado);

    // CARTÃO: empurra para a fatura, NÃO baixa
    if (estado.forma === FORMA_CARTAO) {
      await enviar(B, chatId, "⏳ Transferindo para a fatura do cartão…");
      let r;
      try {
        r = await rolarParaCartao(estado.parcela.id, {
          juros: jurosDe(estado),
          idCartao: estado.cartao?.id || estado.conta,
          nomeCartao: estado.cartao?.nome,
          vencimentoFatura: estado.vencimentoFatura,
          novoValorConta: estado.valorConta ?? estado.valorContaCartao,
        });
      } catch (e: any) {
        await enviar(B, chatId, "❌ Erro: " + escTg(String(e?.message || e)) + "\n<i>Confira na Vobi.</i>");
        return;
      }
      await apagarEstado(db, token);
      if (!r.ok) {
        await enviar(B, chatId, `⚠️ <b>NÃO consegui confirmar.</b>\n${escTg(r.mensagem)}`);
        return;
      }
      let txt = `✅ <b>Lançado no cartão!</b>\n\n`;
      txt += `${escTg(estado.parcela.fornecedor || "")} — ${escTg(estado.parcela.descricao.slice(0, 45))}\n`;
      txt += `💳 ${escTg(r.cartao)}\n`;
      txt += `Vencimento: ${dataBR(r.vencimentoAntes)} → <b>${dataBR(r.vencimentoDepois)}</b>\n`;
      if (Math.abs(r.valorConta - r.valorAntes) >= 0.01) {
        txt += `Valor da conta: ${brl(r.valorAntes)} → <b>${brl(r.valorConta)}</b> (corrigido)\n`;
      }
      txt += `Valor: ${brl(r.valorConta)}${r.juros > 0 ? ` + ${brl(r.juros)} juros = <b>${brl(r.valorDepois)}</b>` : ""}\n`;
      txt += `\n<i>Continua em aberto até a fatura ser paga. Lançado por ${escTg(estado.autor)}.</i>`;
      await enviar(B, chatId, txt);
      return;
    }

    // DEMAIS FORMAS: baixa normal
    await enviar(B, chatId, "⏳ Dando baixa na Vobi…");
    let r;
    try {
      r = await darBaixa({
        idInstallment: estado.parcela.id,
        valorPago: estado.valorPago,
        // o valor que a conta REALMENTE tinha — sem isso a Vobi registraria a
        // diferença como juros, que foi o erro que a Adriana pegou (16/09/2026)
        valorConta: contaDe(estado),
        dataPagamento: estado.dataPagamento,
        idPaymentBankAccount: estado.conta,
        idPaymentType: estado.forma,
      });
    } catch (e: any) {
      await enviar(B, chatId, "❌ Erro ao dar baixa: " + escTg(String(e?.message || e)) + "\n<i>Nada confirmado — confira na Vobi.</i>");
      return;
    }

    await apagarEstado(db, token);

    if (!r.ok) {
      await enviar(B, chatId, `⚠️ <b>NÃO consegui confirmar a baixa.</b>\n${escTg(r.mensagem)}\n\n<i>Não considere paga — confira na Vobi.</i>`);
      return;
    }

    let txt = `✅ <b>Baixa confirmada na Vobi!</b>\n\n`;
    txt += `${escTg(estado.parcela.fornecedor || "")} — ${escTg(estado.parcela.descricao.slice(0, 45))}\n`;
    txt += `Venc. ${dataBR(estado.parcela.vencimento)} · pago ${brl(r.valorPago)} em ${dataBR(estado.dataPagamento)}\n`;
    if (Math.abs(r.valorOriginal - estado.parcela.valor) >= 0.01) {
      txt += `Valor da conta: ${brl(estado.parcela.valor)} → <b>${brl(r.valorOriginal)}</b> (corrigido)\n`;
    }
    if (r.juros > 0) txt += `Juros/multa lançados: <b>${brl(r.juros)}</b>\n`;
    if (r.desconto > 0) txt += `Desconto lançado: <b>${brl(r.desconto)}</b>\n`;
    txt += `\n<i>Lançado por ${escTg(estado.autor)} via Telegram.</i>`;
    await enviar(B, chatId, txt);
    return;
  }
}

// ───────────── texto/print durante um passo (novo valor ou juros) ─────────────

/** Acha o lançamento deste grupo que está esperando um número digitado. */
async function pendenteEsperandoNumero(db: any, chatId: number) {
  const { data } = await db.from("telegram_sessoes")
    .select("telegram_user_id, dados, estado")
    .like("telegram_user_id", "fb:%")
    .eq("chat_id", String(chatId))
    .in("estado", ["aguarda_valor", "aguarda_valor_conta", "aguarda_conta_resto", "aguarda_juros", "rec_aguarda_valor", "aguarda_fornecedor",
      "novo_busca_forn", "novo_busca_cat", "novo_busca_cc", "novo_cc", "novo_venc"])
    .order("telegram_user_id", { ascending: false })
    .limit(1);
  const linha = (data || [])[0];
  if (!linha) return null;
  // Passo esquecido não pode ficar capturando mensagem do grupo para sempre:
  // depois de 2 horas o lançamento é considerado abandonado.
  const quando = Date.parse(String((linha.dados as any)?.atualizadoEm || ""));
  if (Number.isFinite(quando) && Date.now() - quando > 2 * 60 * 60 * 1000) return null;
  return { token: String(linha.telegram_user_id).slice(3), estado: linha.dados as EstadoBaixa, etapa: linha.estado as string };
}

/** "05/10" ou "05/10/2026" -> AAAA-MM-DD. Sem ano, assume o ano corrente. */
function dataDoTexto(t: string): string | null {
  const m = t.trim().match(/^(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?$/);
  if (!m) return null;
  const dia = Number(m[1]), mes = Number(m[2]);
  let ano = m[3] ? Number(m[3]) : Number(hojeISO().slice(0, 4));
  if (ano < 100) ano += 2000;
  if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return null;
  const iso = `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  const d = new Date(iso + "T12:00:00Z");
  if (Number.isNaN(d.getTime()) || d.getUTCDate() !== dia) return null; // 31/02 etc
  return iso;
}

/** A mensagem é SÓ um número? ("35,90", "R$ 1.400,00"). Se não for, é conversa
 *  normal do grupo e o lançamento pendente não pode engolir. */
function ehSoNumero(texto: string): boolean {
  return /^\s*(r\$\s*)?\d{1,3}(\.\d{3})*(,\d{1,2})?\s*$|^\s*(r\$\s*)?\d+([.,]\d{1,2})?\s*$/i.test(texto.trim());
}

/** Retorna true se a mensagem foi consumida por um lançamento em andamento. */
export async function onTextoDuranteBaixa(db: any, B: Bot, chatId: number, texto: string): Promise<boolean> {
  const p = await pendenteEsperandoNumero(db, chatId);
  if (!p) return false;
  const { token, estado, etapa } = p;

  // ÚNICO passo que espera TEXTO e não número: o nome do fornecedor, depois de
  // "É de outro fornecedor". Como aqui não dá para exigir que seja um número,
  // a proteção contra engolir conversa do grupo é outra: só vale nos primeiros
  // 10 minutos, e só para uma mensagem curta que não seja comando.
  if (etapa === "aguarda_fornecedor") {
    const desde = Date.parse(String((estado as any).atualizadoEm || ""));
    if (Number.isFinite(desde) && Date.now() - desde > 10 * 60 * 1000) return false;
    const nome = texto.trim();
    if (nome.startsWith("/") || nome.length < 2 || nome.length > 40) return false;
    estado.nomeBusca = nome;
    estado.etapa = "buscando";
    await salvarEstado(db, token, estado);
    await enviar(B, chatId, `🔎 Procurando <b>${escTg(nome)}</b> — ${brl(estado.valorPago)}…`);
    await buscarFornecedorEContinuar(db, B, token, estado, chatId);
    return true;
  }

  // ── passos de TEXTO do cadastro de lançamento ──
  // Mesmas travas do aguarda_fornecedor: janela curta, texto curto, sem comando.
  if (etapa.startsWith("novo_")) {
    const desde = Date.parse(String((estado as any).atualizadoEm || ""));
    if (Number.isFinite(desde) && Date.now() - desde > 10 * 60 * 1000) return false;
    const t = texto.trim();
    if (t.startsWith("/") || t.length < 2 || t.length > 40) return false;
    if (!estado.novo) return false;

    if (etapa === "novo_venc") {
      const d = dataDoTexto(t);
      if (!d) {
        await enviar(B, chatId, "Não entendi a data. Escreva <code>05/10</code> ou <code>05/10/2026</code>.", BOTOES_CANCELA(token));
        return true;
      }
      estado.novo.data = d;
      await salvarEstado(db, token, estado);
      await proximoPassoNovo(db, B, token, estado, chatId);
      return true;
    }

    if (etapa === "novo_busca_forn") {
      estado.novo.buscaForn = t;
      estado.novo.idSupplier = undefined;
      await salvarEstado(db, token, estado);
      await pedirFornecedorNovo(db, B, token, estado, chatId);
      return true;
    }

    // categoria e centro de custo: mesma mecânica, catálogos diferentes
    const ehCat = etapa === "novo_busca_cat";
    let achados: ItemCatalogo[] = [];
    try {
      achados = buscarNoCatalogo(ehCat ? await categoriasFinanceiras() : await centrosDeCusto(), t, 6);
    } catch (e: any) {
      await falhaDaVobi(db, B, token, estado, chatId, e, ehCat ? "listar as categorias" : "listar os centros de custo");
      return true;
    }
    if (!achados.length) {
      await enviar(B, chatId,
        `Não achei ${ehCat ? "categoria" : "centro de custo"} com “${escTg(t)}”. Tente outra palavra.`,
        BOTOES_CANCELA(token));
      return true;
    }
    const pre = ehCat ? "fbncat" : "fbncc";
    await enviar(B, chatId, `Achei ${achados.length}. Qual é?`, inline([
      ...achados.map((c) => [{ text: c.nome.trim().slice(0, 55), callback_data: `${pre}:${token}:${c.id}` }]),
      [{ text: "❌ Cancelar", callback_data: `fbnao:${token}` }],
    ]));
    return true;
  }

  // No GRUPO as pessoas conversam. Só engolimos a mensagem quando ela é
  // claramente a resposta do passo — ou seja, um número e nada mais.
  if (!ehSoNumero(texto)) return false;
  const novo = extrairValor(texto);
  if (novo === null) return false;

  // ── juros informados: o valor da conta passa a ser o pago menos os juros ──
  // ── quanto entrou de verdade no recebimento ──
  if (etapa === "rec_aguarda_valor") {
    if (novo <= 0) {
      await enviar(B, chatId, "O valor recebido precisa ser maior que zero.", BOTOES_CANCELA(token));
      return true;
    }
    estado.valorPago = novo;
    estado.juros = 0;
    await salvarEstado(db, token, estado);
    await conferirValorRecebido(db, B, token, estado, chatId);
    return true;
  }

  if (etapa === "aguarda_juros") {
    if (estado.forma !== FORMA_CARTAO && novo > estado.valorPago + 0.001) {
      await enviar(B, chatId,
        `🤔 Os juros (${brl(novo)}) não podem ser maiores que o valor pago (${brl(estado.valorPago)}).\n` +
        `Se o valor pago estiver errado, toque em <b>Voltar</b> e corrija por “Valor pago”.`,
        BOTOES_CANCELA(token));
      return true;
    }
    estado.juros = novo;
    if (estado.forma !== FORMA_CARTAO) {
      estado.valorConta = Math.max(0, Math.round((estado.valorPago - novo) * 100) / 100);
    }
    await irParaConfirmacao(db, B, token, estado, chatId);
    return true;
  }

  // ── "os dois": ela informa a conta e o RESTO do que foi pago vira juros ──
  if (etapa === "aguarda_conta_resto") {
    estado.valorConta = novo;
    estado.juros = estado.forma === FORMA_CARTAO
      ? Math.max(0, Math.round((estado.valorPago - novo) * 100) / 100)
      : undefined; // fora do cartão, juros OU desconto saem do cálculo
    await irParaConfirmacao(db, B, token, estado, chatId);
    return true;
  }

  // ── correção só do valor da conta (no cartão, os juros ficam como estavam) ──
  if (etapa === "aguarda_valor_conta") {
    estado.valorConta = novo;
    if (estado.forma !== FORMA_CARTAO) estado.juros = undefined;
    await irParaConfirmacao(db, B, token, estado, chatId);
    return true;
  }

  // Sessão criada ANTES desta versão: no cartão, "aguarda_valor" significava o
  // valor da CONTA (hoje o cartão usa "aguarda_valor_conta"). Mantém o sentido
  // antigo para não apagar os juros já informados.
  if (estado.forma === FORMA_CARTAO) {
    estado.valorConta = novo;
    await irParaConfirmacao(db, B, token, estado, chatId);
    return true;
  }

  // ── valor PAGO: mudou o que saiu da conta, então a diferença volta a ser
  //    incógnita — esquecemos o que já foi resolvido e perguntamos de novo.
  estado.valorPago = novo;
  estado.valorConta = undefined;
  estado.valorContaCartao = undefined;
  estado.juros = undefined;
  estado.jurosCartao = undefined;
  if (!estado.parcela) {
    estado.etapa = "confirmar";
    await salvarEstado(db, token, estado);
    await mostrarParcelas(db, B, token, estado, chatId);
    return true;
  }
  if (precisaResolverDiferenca(estado)) {
    await perguntarDiferenca(db, B, token, estado, chatId);
    return true;
  }
  await irParaConfirmacao(db, B, token, estado, chatId);
  return true;
}

/** Print da fatura enquanto o bot espera os juros do cartão. */
export async function onPrintDuranteBaixa(db: any, B: Bot, msg: any, chatId: number): Promise<boolean> {
  const p = await pendenteEsperandoNumero(db, chatId);
  if (!p || p.etapa !== "aguarda_juros") return false;
  let fileId = "", ct = "image/jpeg", nomeArq = "print.jpg";
  if (msg.document) { fileId = msg.document.file_id; ct = msg.document.mime_type || "application/pdf"; nomeArq = msg.document.file_name || "fatura.pdf"; }
  else if (msg.photo?.length) fileId = msg.photo[msg.photo.length - 1].file_id;
  if (!fileId) return false;

  await enviar(B, chatId, "🔎 Lendo o print… ⏳");
  const buf = await baixarArquivoTg(B, fileId);
  if (!buf) { await enviar(B, chatId, "❌ Não consegui baixar. Mande o valor por texto."); return true; }

  const SYS = "Você lê faturas e comprovantes de cartão de crédito brasileiros. Responda SÓ um JSON.";
  const PEDIDO = `Qual o valor de JUROS / ENCARGOS / ACRÉSCIMO neste documento? Devolva {"juros": number} em reais (0 se não houver).`;
  const ctL = ct.toLowerCase();
  let juros = NaN;

  // mesma escada do comprovante: texto do PDF primeiro (sem cota), visão depois
  const texto = await extrairTextoConteudo(buf, ctL, nomeArq);
  if (texto && llmConfigurado()) {
    const bruto = await gerarTextoLLM(SYS, [{ role: "user", content: `${PEDIDO}\n\nDOCUMENTO:\n${texto.slice(0, 6000)}` }]).catch(() => null);
    const j = bruto ? extrairJson(bruto) : null;
    if (j && Number.isFinite(Number(j.juros))) juros = Number(j.juros);
  }
  if (!Number.isFinite(juros) && (ctL === "application/pdf" || ctL.startsWith("image/"))) {
    const r = await lerDocumentoLLM(SYS, PEDIDO, buf.toString("base64"), ct).catch(() => ({ texto: null }));
    const j = r.texto ? extrairJson(r.texto) : null;
    if (j && Number.isFinite(Number(j.juros))) juros = Number(j.juros);
  }

  if (!Number.isFinite(juros) || juros < 0) {
    await enviar(B, chatId, "🤔 Não consegui ler os juros. Mande o valor por texto, ex.: <code>35,90</code>");
    return true;
  }
  p.estado.juros = juros;
  if (p.estado.forma !== FORMA_CARTAO) {
    p.estado.valorConta = Math.max(0, Math.round((p.estado.valorPago - juros) * 100) / 100);
  }
  await enviar(B, chatId, `📄 Li <b>${brl(juros)}</b> de juros.`);
  await irParaConfirmacao(db, B, p.token, p.estado, chatId);
  return true;
}
