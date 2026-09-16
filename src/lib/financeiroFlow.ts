// Fluxo de BAIXA DE PAGAMENTO no grupo financeiro do Telegram (@cjr_adm_bot).
//
// Como a Adriana pediu (16/09/2026):
//   1. alguém do grupo manda "1400 construtivo" (valor + fornecedor) ou o comprovante
//   2. o bot acha as parcelas EM ABERTO daquele fornecedor — inclusive VENCIDAS,
//      porque ela quase sempre paga com atraso — e mostra os vencimentos
//   3. escolhido o vencimento, ele calcula os JUROS (o que passou do valor devido)
//   4. mostra o resumo e pergunta com botões:  [✅ Sim] [❌ Não] [✏️ Alterar]
//      "Alterar" pergunta o que mudar: [💵 Valor] [📅 Vencimento]
//   5. confirmado, dá baixa na Vobi e RELÊ a parcela para provar que gravou
//
// O estado de cada baixa em andamento fica em telegram_sessoes na chave
// "fb:<token>" — o token viaja no callback_data, então várias pessoas podem
// lançar baixas ao mesmo tempo no grupo sem uma atrapalhar a outra.

import { escTg } from "./telegram";
import { type Bot, enviar, inline, tg } from "./telegramBot";
import {
  buscarFornecedoresAproximado, fornecedores, parcelasCandidatas, darBaixa,
  calcularAcrescimo, CONTAS_PRINCIPAIS, FORMAS_PAGAMENTO,
  CONTA_PADRAO, FORMA_PADRAO, vobiBaixaConfigurada,
  type Candidata, type Fornecedor,
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
  // 1.234,56 | 1234,56 | 1234.56 | 1234
  const m = t.match(/\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+,\d{1,2}|\d+\.\d{2}(?!\d)|\d+/g);
  if (!m) return null;
  // usa o MAIOR número do texto (evita pegar "2" de "2 vias")
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

// ───────────────────────── estado da baixa ─────────────────────────

type EstadoBaixa = {
  chat_id: number;
  autor: string;
  valorPago: number;
  dataPagamento: string;
  fornecedor?: { id: number; nome: string };
  candidatas?: Candidata[];
  parcela?: { id: string; descricao: string; valor: number; vencimento: string; fornecedor: string | null };
  conta: number;
  forma: number;
  etapa: string;
};

async function salvarEstado(db: any, token: string, dados: EstadoBaixa) {
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

// ───────────────────────────── passo 1 ─────────────────────────────

/** Entrada por TEXTO no grupo: "1400 construtivo". */
export async function onTextoFinanceiro(db: any, B: Bot, msg: any, chatId: number, texto: string) {
  if (!vobiBaixaConfigurada()) {
    await enviar(B, chatId, "⚠️ As credenciais da Vobi não estão configuradas — não consigo dar baixa.");
    return;
  }
  const valor = extrairValor(texto);
  const nome = extrairNome(texto);

  if (!valor) {
    await enviar(B, chatId, "Para dar baixa, me diga o <b>valor</b> e o <b>fornecedor</b>.\nEx.: <code>1400 construtivo</code>\n\nOu mande o <b>comprovante</b> (foto/PDF) que eu leio. 📎");
    return;
  }
  if (nome.length < 2) {
    await enviar(B, chatId, `Entendi o valor <b>${brl(valor)}</b>, mas não o fornecedor.\nMande assim: <code>${valor} nome do fornecedor</code>`);
    return;
  }

  const token = novoToken();
  const estado: EstadoBaixa = {
    chat_id: chatId,
    autor: `${msg.from?.first_name || ""} ${msg.from?.last_name || ""}`.trim() || "alguém",
    valorPago: valor,
    dataPagamento: hojeISO(),
    conta: CONTA_PADRAO,
    forma: FORMA_PADRAO,
    etapa: "buscando",
  };

  await enviar(B, chatId, `🔎 Procurando <b>${escTg(nome)}</b> — ${brl(valor)}…`);

  let achados: Fornecedor[];
  try {
    achados = await buscarFornecedoresAproximado(nome, 6);
  } catch (e: any) {
    await enviar(B, chatId, "❌ Não consegui consultar a Vobi agora: " + escTg(String(e?.message || e)));
    return;
  }

  if (!achados.length) {
    await enviar(B, chatId, `❌ Não achei nenhum fornecedor com <b>${escTg(nome)}</b> na Vobi.\nTente outro pedaço do nome.`);
    return;
  }

  if (achados.length === 1) {
    estado.fornecedor = { id: achados[0].id, nome: achados[0].nome || achados[0].razao };
    await salvarEstado(db, token, estado);
    return await mostrarParcelas(db, B, token, estado, chatId);
  }

  estado.etapa = "esc_fornecedor";
  await salvarEstado(db, token, estado);
  const botoes = achados.map((f) => [{ text: (f.nome || f.razao).slice(0, 55), callback_data: `fbforn:${token}:${f.id}` }]);
  botoes.push([{ text: "❌ Cancelar", callback_data: `fbnao:${token}` }]);
  await enviar(B, chatId, `Achei <b>${achados.length}</b> fornecedores com “${escTg(nome)}”. Qual é?`, inline(botoes));
}

// ───────────────────────────── passo 2 ─────────────────────────────

async function mostrarParcelas(db: any, B: Bot, token: string, estado: EstadoBaixa, chatId: number) {
  const f = estado.fornecedor!;
  let cands: Candidata[];
  try {
    cands = await parcelasCandidatas(f.id, estado.valorPago, f.nome, 6);
  } catch (e: any) {
    await enviar(B, chatId, "❌ Falha ao buscar as parcelas: " + escTg(String(e?.message || e)));
    return;
  }

  if (!cands.length) {
    await enviar(B, chatId, `❌ <b>${escTg(f.nome)}</b> não tem nenhuma parcela em aberto na Vobi.\n\nPode ser que já esteja baixada, ou que o pagamento esteja cadastrado em outro fornecedor.`);
    await apagarEstado(db, token);
    return;
  }

  estado.candidatas = cands;
  estado.etapa = "esc_parcela";
  await salvarEstado(db, token, estado);

  // uma única candidata com valor EXATO → já vai direto pra confirmação
  if (cands.length === 1 || (cands[0].exata && !cands[1]?.exata)) {
    return await propor(db, B, token, estado, chatId, cands[0]);
  }

  const botoes = cands.map((c, i) => {
    const atraso = c.diasAtraso > 0 ? ` (${c.diasAtraso}d atraso)` : "";
    return [{ text: `${dataBR(c.vencimento).slice(0, 5)} · ${brl(c.valor)}${atraso}`.slice(0, 60), callback_data: `fbparc:${token}:${i}` }];
  });
  botoes.push([{ text: "❌ Cancelar", callback_data: `fbnao:${token}` }]);

  const linhas = cands.map((c, i) => {
    const marca = c.exata ? " ✅ valor exato" : c.diferenca > 0 ? ` (+${brl(c.diferenca)} de juros)` : "";
    const atraso = c.diasAtraso > 0 ? ` · ${c.diasAtraso}d atraso` : "";
    return `${i + 1}. <b>${dataBR(c.vencimento)}</b> — ${brl(c.valor)}${marca}${atraso}\n    <i>${escTg(c.descricao.slice(0, 45))}</i>`;
  }).join("\n");

  await enviar(B, chatId,
    `📋 <b>${escTg(f.nome)}</b> — você pagou ${brl(estado.valorPago)}.\nA qual vencimento se refere?\n\n${linhas}`,
    inline(botoes));
}

// ───────────────────────────── passo 3 ─────────────────────────────

async function propor(db: any, B: Bot, token: string, estado: EstadoBaixa, chatId: number, c: Candidata) {
  estado.parcela = { id: c.id, descricao: c.descricao, valor: c.valor, vencimento: c.vencimento, fornecedor: c.fornecedor };
  estado.etapa = "confirmar";
  await salvarEstado(db, token, estado);
  await enviar(B, chatId, resumo(estado), inline([
    [
      { text: "✅ Sim", callback_data: `fbsim:${token}` },
      { text: "❌ Não", callback_data: `fbnao:${token}` },
      { text: "✏️ Alterar", callback_data: `fbalt:${token}` },
    ],
  ]));
}

function resumo(e: EstadoBaixa): string {
  const p = e.parcela!;
  const { juros, desconto } = calcularAcrescimo(p.valor, e.valorPago);
  const contaNome = CONTAS_PRINCIPAIS.find((c) => c.id === e.conta)?.nome || `conta ${e.conta}`;
  const formaNome = FORMAS_PAGAMENTO.find((f) => f.id === e.forma)?.nome || "—";
  const atraso = (() => {
    const d = Math.round((Date.parse(e.dataPagamento) - Date.parse(p.vencimento)) / 86400000);
    return d > 0 ? ` · <b>${d} dia(s) de atraso</b>` : "";
  })();

  let txt = `💰 <b>Confirmar a baixa?</b>\n\n`;
  txt += `<b>Fornecedor:</b> ${escTg(p.fornecedor || "—")}\n`;
  txt += `<b>Conta:</b> ${escTg(p.descricao.slice(0, 50))}\n`;
  txt += `<b>Vencimento:</b> ${dataBR(p.vencimento)}${atraso}\n`;
  txt += `<b>Valor devido:</b> ${brl(p.valor)}\n`;
  txt += `<b>Valor pago:</b> ${brl(e.valorPago)}\n`;
  if (juros > 0) txt += `<b>Juros/multa:</b> ${brl(juros)} ⚠️\n`;
  if (desconto > 0) txt += `<b>Desconto:</b> ${brl(desconto)}\n`;
  txt += `<b>Pago em:</b> ${dataBR(e.dataPagamento)}\n`;
  txt += `<b>Saiu de:</b> ${escTg(contaNome)} · ${escTg(formaNome)}\n`;
  return txt;
}

// ───────────────────────── callbacks (botões) ─────────────────────────

export async function onCallbackFinanceiro(db: any, B: Bot, cq: any, chatId: number, data: string) {
  const [acao, token, arg] = data.split(":");
  const estado = await lerEstado(db, token);
  if (!estado) {
    await enviar(B, chatId, "Essa baixa já foi tratada ou expirou. Mande o valor e o fornecedor de novo. 👍");
    return;
  }

  // ── fornecedor escolhido ──
  if (acao === "fbforn") {
    const id = Number(arg);
    const f = (await fornecedores()).find((x) => x.id === id);
    estado.fornecedor = { id, nome: f ? f.nome || f.razao : `fornecedor ${id}` };
    await salvarEstado(db, token, estado);
    return await mostrarParcelas(db, B, token, estado, chatId);
  }

  // ── parcela escolhida ──
  if (acao === "fbparc") {
    const c = (estado.candidatas || [])[Number(arg)];
    if (!c) { await enviar(B, chatId, "Não achei essa opção. Tente de novo."); return; }
    return await propor(db, B, token, estado, chatId, c);
  }

  // ── NÃO / cancelar ──
  if (acao === "fbnao") {
    await apagarEstado(db, token);
    await enviar(B, chatId, "❌ Baixa cancelada. Nada foi alterado na Vobi.");
    return;
  }

  // ── ALTERAR → o que? ──
  if (acao === "fbalt") {
    estado.etapa = "alterar";
    await salvarEstado(db, token, estado);
    await enviar(B, chatId, "✏️ O que você quer alterar?", inline([
      [
        { text: "💵 Valor", callback_data: `fbaltv:${token}` },
        { text: "📅 Vencimento", callback_data: `fbaltd:${token}` },
      ],
      [{ text: "⬅️ Voltar", callback_data: `fbvolta:${token}` }],
    ]));
    return;
  }

  if (acao === "fbaltv") {
    estado.etapa = "aguarda_valor";
    await salvarEstado(db, token, estado);
    await enviar(B, chatId, `💵 Qual foi o valor pago de verdade?\n<i>(hoje está ${brl(estado.valorPago)} — mande só o número)</i>`);
    return;
  }

  if (acao === "fbaltd") {
    // volta pra lista de vencimentos do mesmo fornecedor
    return await mostrarParcelas(db, B, token, estado, chatId);
  }

  if (acao === "fbvolta") {
    if (!estado.parcela) return await mostrarParcelas(db, B, token, estado, chatId);
    estado.etapa = "confirmar";
    await salvarEstado(db, token, estado);
    await enviar(B, chatId, resumo(estado), inline([
      [
        { text: "✅ Sim", callback_data: `fbsim:${token}` },
        { text: "❌ Não", callback_data: `fbnao:${token}` },
        { text: "✏️ Alterar", callback_data: `fbalt:${token}` },
      ],
    ]));
    return;
  }

  // ── SIM → executa a baixa ──
  if (acao === "fbsim") {
    if (!estado.parcela) { await enviar(B, chatId, "Faltou escolher a parcela."); return; }
    await enviar(B, chatId, "⏳ Dando baixa na Vobi…");
    let r;
    try {
      r = await darBaixa({
        idInstallment: estado.parcela.id,
        valorPago: estado.valorPago,
        dataPagamento: estado.dataPagamento,
        idPaymentBankAccount: estado.conta,
        idPaymentType: estado.forma,
      });
    } catch (e: any) {
      await enviar(B, chatId, "❌ Erro ao dar baixa: " + escTg(String(e?.message || e)) + "\n<i>Nada foi confirmado — confira na Vobi.</i>");
      return;
    }

    await apagarEstado(db, token);

    if (!r.ok) {
      await enviar(B, chatId, `⚠️ <b>NÃO consegui confirmar a baixa.</b>\n${escTg(r.mensagem)}\n\n<i>Não considere paga — confira direto na Vobi.</i>`);
      return;
    }

    let txt = `✅ <b>Baixa confirmada na Vobi!</b>\n\n`;
    txt += `${escTg(estado.parcela.fornecedor || "")} — ${escTg(estado.parcela.descricao.slice(0, 45))}\n`;
    txt += `Venc. ${dataBR(estado.parcela.vencimento)} · pago ${brl(r.valorPago)} em ${dataBR(estado.dataPagamento)}\n`;
    if (r.juros > 0) txt += `Juros lançados: <b>${brl(r.juros)}</b>\n`;
    txt += `\n<i>Lançado por ${escTg(estado.autor)} via Telegram.</i>`;
    await enviar(B, chatId, txt);
    return;
  }
}

// ───────────────── texto durante um passo (ex.: novo valor) ─────────────────

/** Se alguém está no meio de uma baixa e digita algo, tratamos aqui.
 *  Retorna true se a mensagem foi consumida pelo fluxo. */
export async function onTextoDuranteBaixa(db: any, B: Bot, chatId: number, texto: string): Promise<boolean> {
  const { data } = await db.from("telegram_sessoes")
    .select("telegram_user_id, dados, estado")
    .like("telegram_user_id", "fb:%")
    .eq("chat_id", String(chatId))
    .eq("estado", "aguarda_valor")
    .order("telegram_user_id", { ascending: false })
    .limit(1);
  const linha = (data || [])[0];
  if (!linha) return false;

  const token = String(linha.telegram_user_id).slice(3);
  const estado: EstadoBaixa = linha.dados;
  const novo = extrairValor(texto);
  if (!novo) {
    await enviar(B, chatId, "Não entendi o valor. Mande só o número, ex.: <code>1450,00</code>");
    return true;
  }
  estado.valorPago = novo;
  estado.etapa = "confirmar";
  await salvarEstado(db, token, estado);

  if (!estado.parcela) {
    await mostrarParcelas(db, B, token, estado, chatId);
    return true;
  }
  await enviar(B, chatId, resumo(estado), inline([
    [
      { text: "✅ Sim", callback_data: `fbsim:${token}` },
      { text: "❌ Não", callback_data: `fbnao:${token}` },
      { text: "✏️ Alterar", callback_data: `fbalt:${token}` },
    ],
  ]));
  return true;
}
