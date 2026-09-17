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
import { type Bot, enviar, inline, baixarArquivoTg, extrairTextoConteudo } from "./telegramBot";
import { lerDocumentoLLM, gerarTextoLLM, llmConfigurado, extrairJson } from "./llm";
import {
  buscarFornecedoresAproximado, fornecedores, parcelasCandidatas, parcelasAbertasPorValor, fornecedoresComContaEmAberto, parcelasAbertasDeFornecedores, parcelaPorId, darBaixa,
  rolarParaCartao, proximoVencimentoCartao, calcularAcrescimo,
  CONTAS_PRINCIPAIS, FORMAS_PAGAMENTO, CARTOES,
  CONTA_PADRAO, FORMA_PADRAO, FORMA_CARTAO, vobiBaixaConfigurada,
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
  etapa: string;
  /** o que a pessoa (ou o comprovante) deu como nome do fornecedor — guardado
   *  para o "🔄 Tentar de novo" refazer a busca sem pedir o comprovante de novo */
  nomeBusca?: string;
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
  lido?: { forma?: number; valorConta?: number; juros?: number },
) {
  const token = novoToken();
  const estado: EstadoBaixa = {
    chat_id: chatId,
    autor,
    valorPago: valor,
    dataPagamento: dataPag || hojeISO(),
    forma: lido?.forma ?? FORMA_PADRAO,
    formaDoComprovante: lido?.forma != null,
    conta: CONTA_PADRAO, // no cartão, entrarNoCartao troca pela conta do cartão
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
    await enviar(
      B,
      chatId,
      `❌ Nenhum fornecedor com <b>${escTg(nome)}</b> tem conta em aberto.\n\n<i>Num depósito judicial ou guia de imposto o favorecido do comprovante é o tribunal ou o órgão, não o fornecedor — nesses casos o que liga é o valor.</i>`,
      inline([
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

// ───────────────────── entrada: COMPROVANTE (foto/PDF) ─────────────────────

const SYS_COMPROVANTE =
  "Você lê comprovantes de pagamento brasileiros (PIX, boleto, TED, DOC, cartão) e extrai os dados. Responda SÓ um JSON.";

const PEDIDO_COMPROVANTE = `Devolva JSON com as chaves:
{"valor": number (VALOR TOTAL efetivamente pago/cobrado — o "Valor total", já com
   juros/IOF se houver),
 "valor_nominal": number (o valor da CONTA antes dos acréscimos — a linha "Valor".
   Se o comprovante não separar, use null),
 "encargos": number (soma de juros + multa + IOF + acréscimos. 0 se não houver,
   null se o comprovante não informar),
 "forma": string (como foi pago, um de: "pix", "boleto", "cartao_credito",
   "cartao_debito", "debito_em_conta", "transferencia", "dinheiro". null se não disser),
 "favorecido": string (nome de quem RECEBEU o dinheiro — a empresa/pessoa beneficiária.
   NUNCA o pagador: a pagadora é sempre a COSTA JUNIOR ENGENHARIA. Se aparecerem os dois,
   devolva o OUTRO, não a Costa Júnior),
 "data": "AAAA-MM-DD" (data do pagamento)}
Se não achar algum campo, use null.`;

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

/** A Costa Júnior é sempre a PAGADORA — se a leitura devolver ela, está errada. */
function ehAPropriaCJR(nome: string): boolean {
  return /costa\s*j(u|ú)nior|costajr|costa\s*jr/i.test(nome);
}

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

  // ── CAMADA 1: legenda digitada junto com o arquivo ──
  const legenda = String(msg.caption || "").trim();
  if (legenda) {
    valor = extrairValor(legenda);
    const n = extrairNome(legenda);
    if (n.length >= 2) favorecido = n;
    if (valor && favorecido) comoLi = "pela legenda";
  }

  const usar = (j: any, de: string) => {
    if (!j) return;
    if (!valor) valor = Number(j.valor) || null;
    const f = String(j.favorecido || "").trim();
    if (!favorecido && f && !ehAPropriaCJR(f)) favorecido = f;
    if (!data && /^\d{4}-\d{2}-\d{2}$/.test(String(j.data || ""))) data = String(j.data);
    if (forma == null) forma = formaDoTexto(j.forma);
    if (!bruta) bruta = j;
    if (valor && favorecido && !comoLi) comoLi = de;
  };

  // ── CAMADA 2: texto de dentro do PDF (sem IA) + LLM de texto ──
  const texto = await extrairTextoConteudo(buf, ctL, nome);
  if (texto && llmConfigurado() && (!valor || !favorecido || forma == null)) {
    const resp = await gerarTextoLLM(SYS_COMPROVANTE, [
      { role: "user", content: `${PEDIDO_COMPROVANTE}\n\nCOMPROVANTE:\n${texto.slice(0, 6000)}` },
    ]).catch(() => null);
    usar(resp ? extrairJson(resp) : null, "do texto do comprovante");
  }

  // ── CAMADA 3: visão — foto, ou PDF escaneado (sem camada de texto) ──
  let erroVisao = "";
  if ((!valor || !favorecido || forma == null) && (ctL === "application/pdf" || ctL.startsWith("image/"))) {
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
        if (!valor || !favorecido) erroVisao = `${r.provedor} leu mas devolveu ${JSON.stringify(j).slice(0, 80)}`;
      }
    }
  }

  if (!data) data = hojeISO();

  if (!valor || !favorecido) {
    const falta = !valor && !favorecido ? "o valor nem o favorecido" : !valor ? "o valor" : "o favorecido";
    // sem o motivo é impossível saber se foi cota, formato ou leitura ruim
    const porque = erroVisao ? `\n<i>(leitura por imagem: ${escTg(erroVisao.slice(0, 110))})</i>` : "";
    await enviar(B, chatId,
      `🤔 Não consegui identificar <b>${falta}</b> nesse comprovante.${porque}\n\n` +
      `Me manda assim: <code>${valor ? valor : "431,20"} ${favorecido || "nome do fornecedor"}</code>`);
    return;
  }

  // O comprovante do cartão já separa "Valor" de "Juros"/"IOF" — se as contas
  // fecharem com o total, aproveitamos e não perguntamos nada disso.
  const dec = conferirDecomposicao(valor, bruta?.valor_nominal, bruta?.encargos);
  const nomeForma = FORMAS_PAGAMENTO.find((f) => f.id === forma)?.nome;

  let txt = `📄 <b>Li do comprovante</b> <i>(${comoLi})</i>:\n`;
  txt += `<b>Favorecido:</b> ${escTg(favorecido)}\n`;
  if (dec && dec.juros > 0) {
    txt += `<b>Valor da conta:</b> ${brl(dec.valorConta)}\n`;
    txt += `<b>Juros/encargos:</b> ${brl(dec.juros)}\n`;
    txt += `<b>Total pago:</b> ${brl(valor)}\n`;
  } else {
    txt += `<b>Valor:</b> ${brl(valor)}\n`;
  }
  txt += `<b>Data:</b> ${dataBR(data)}\n`;
  if (nomeForma) txt += `<b>Forma:</b> ${escTg(nomeForma)}\n`;
  await enviar(B, chatId, txt);

  await iniciar(db, B, chatId, autorDe(msg), valor, favorecido, data, {
    forma: forma ?? undefined,
    valorConta: dec?.valorConta,
    juros: dec?.juros,
  });
}

// ───────────────────────── escolha da parcela ─────────────────────────

async function mostrarParcelas(db: any, B: Bot, token: string, estado: EstadoBaixa, chatId: number) {
  const f = estado.fornecedor!;
  let cands: Candidata[];
  try {
    cands = await parcelasCandidatas(f.id, estado.valorPago, f.nome, 6);
  } catch (e: any) {
    return await falhaDaVobi(db, B, token, estado, chatId, e, "buscar as parcelas em aberto");
  }

  if (!cands.length) {
    await enviar(B, chatId, `❌ <b>${escTg(f.nome)}</b> não tem nenhuma parcela em aberto na Vobi.\n\nPode já estar baixada, ou o lançamento estar em outro fornecedor.`);
    await apagarEstado(db, token);
    return;
  }

  estado.candidatas = cands;
  estado.etapa = "esc_parcela";
  await salvarEstado(db, token, estado);

  if (cands.length === 1 || (cands[0].exata && !cands[1]?.exata)) {
    return await escolherParcela(db, B, token, estado, chatId, cands[0]);
  }

  const botoes = cands.map((c, i) => {
    const atraso = c.diasAtraso > 0 ? ` (${c.diasAtraso}d atraso)` : "";
    // o ID da parcela vai no botão (não o índice da lista): se alguém tocar num
    // botão de uma lista ANTIGA, o índice apontaria para outra conta
    return [{ text: `${dataBR(c.vencimento).slice(0, 5)} · ${brl(c.valor)}${atraso}`.slice(0, 60), callback_data: `fbparc:${token}:${c.id}` }];
  });
  botoes.push([{ text: "❌ Cancelar", callback_data: `fbnao:${token}` }]);

  const linhas = cands.map((c, i) => {
    const marca = c.exata ? " ✅ valor exato" : c.diferenca > 0 ? ` (+${brl(c.diferenca)})` : "";
    const atraso = c.diasAtraso > 0 ? ` · ${c.diasAtraso}d atraso` : "";
    return `${i + 1}. <b>${dataBR(c.vencimento)}</b> — ${brl(c.valor)}${marca}${atraso}\n    <i>${escTg(c.descricao.slice(0, 45))}</i>`;
  }).join("\n");

  await enviar(B, chatId,
    `📋 <b>${escTg(f.nome)}</b> — pagamento de ${brl(estado.valorPago)}.\nA qual vencimento se refere?\n\n${linhas}`,
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
  const contaNome = CONTAS_PRINCIPAIS.find((c) => c.id === e.conta)?.nome || `conta ${e.conta}`;
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
  txt += `<b>Saiu de:</b> ${escTg(contaNome)} · ${escTg(formaNome)}\n`;
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
  estado.conta = CONTA_PADRAO;
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

  const [acao, token, arg] = data.split(":");
  const estado = await lerEstado(db, token);
  if (!estado) {
    await enviar(B, chatId, "Esse lançamento já foi tratado ou expirou. Mande o valor e o fornecedor de novo. 👍");
    return;
  }

  // "🔄 Tentar de novo" depois de a Vobi recusar: retoma de onde parou, sem
  // pedir o comprovante de novo.
  if (acao === "fbretry") {
    if (estado.fornecedor) return await mostrarParcelas(db, B, token, estado, chatId);
    await enviar(B, chatId, `🔎 Procurando <b>${escTg(estado.nomeBusca || "")}</b> — ${brl(estado.valorPago)}…`);
    return await buscarFornecedorEContinuar(db, B, token, estado, chatId);
  }

  // ── "não é nenhum desses": procura pelo VALOR, em qualquer fornecedor ──
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
          [{ text: "🔁 Forma de pagamento", callback_data: `fbaltf:${token}` }],
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
    .in("estado", ["aguarda_valor", "aguarda_valor_conta", "aguarda_conta_resto", "aguarda_juros"])
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

  // No GRUPO as pessoas conversam. Só engolimos a mensagem quando ela é
  // claramente a resposta do passo — ou seja, um número e nada mais.
  if (!ehSoNumero(texto)) return false;
  const novo = extrairValor(texto);
  if (novo === null) return false;

  // ── juros informados: o valor da conta passa a ser o pago menos os juros ──
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
