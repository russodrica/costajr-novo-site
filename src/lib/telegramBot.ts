// ════════════════════════════════════════════════════════════════════════
// Bot INBOUND do Telegram (@cjr_ativo_bot) — "caminho de volta", GUIADO.
// Fluxo (pedido da Adriana): identifica pelo telefone → "Quer registrar uma
// movimentação?" → tipo (Telefone/Veículo/Equip. de obra/Informática) →
// acha o equipamento → "Para onde?" (pessoa/obra/estoque/defeito) → confirma →
// "Equipamento movimentado com sucesso!" e atualiza a base.
// SEM LLM — máquina de estados em telegram_sessoes. Token = TELEGRAM_BOT_TOKEN.
// ════════════════════════════════════════════════════════════════════════
import { supabaseAdmin } from "./supabase";
import { enviarTelegram, escTg } from "./telegram";
import { SLOTS_DOC, slotPorKey, detectarSlotPorTexto, detectarValidade, casarColaborador } from "./slotsDoc";
import { lerDocumentoGemini, geminiConfigurado, gerarTextoLLM, llmConfigurado, extrairJson } from "./llm";
import { registrarAcao } from "./auditoria";

function envVar(name: string): string {
  return (import.meta.env as any)[name] || (process.env as any)[name] || "";
}
const TOKEN = envVar("TELEGRAM_BOT_TOKEN"); // bot de Ativos

// ── Telegram API helpers (best-effort) ──────────────────────────────────
async function tg(metodo: string, corpo: any): Promise<any> {
  if (!TOKEN) return { ok: false };
  try {
    const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${metodo}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo),
    });
    return await r.json().catch(() => ({}));
  } catch { return { ok: false }; }
}
function enviar(chatId: number | string, texto: string, teclado?: any) {
  const corpo: any = { chat_id: chatId, text: texto, parse_mode: "HTML", disable_web_page_preview: true };
  if (teclado) corpo.reply_markup = teclado;
  return tg("sendMessage", corpo);
}
function responderCallback(id: string, texto?: string) {
  return tg("answerCallbackQuery", { callback_query_id: id, ...(texto ? { text: texto } : {}) });
}
const botaoTelefone = { keyboard: [[{ text: "📱 Compartilhar meu telefone", request_contact: true }]], resize_keyboard: true, one_time_keyboard: true };
const tirarTeclado = { remove_keyboard: true };
function inline(linhas: { text: string; callback_data: string }[][]) { return { inline_keyboard: linhas }; }
const btnCancelar = [{ text: "❌ Cancelar", callback_data: "cancel" }];

// ── Telefone: normalização e match SEGURO ───────────────────────────────
function soDigitos(s: unknown): string { return String(s ?? "").replace(/\D/g, ""); }
function normalizaTel(s: unknown): string {
  let d = soDigitos(s);
  if (d.startsWith("55") && d.length > 11) d = d.slice(2);
  return d.replace(/^0+/, "");
}
function chaveTel(s: unknown): string {
  const d = normalizaTel(s);
  if (d.length < 10) return "";
  const local = d.slice(-8);
  if (/^(\d)\1{7}$/.test(local)) return "";
  return d.slice(0, 2) + local;
}
function telBate(a: unknown, b: unknown): boolean {
  const x = chaveTel(a), y = chaveTel(b);
  return !!x && x === y;
}

// ── Sessão (telegram_sessoes) ───────────────────────────────────────────
type Sessao = { telegram_user_id: string; nome?: string; chat_id?: string; estado?: string; dados?: any };
async function getSessao(db: any, userId: string): Promise<Sessao | null> {
  const { data } = await db.from("telegram_sessoes").select("*").eq("telegram_user_id", userId).maybeSingle();
  return data || null;
}
async function salvarSessao(db: any, s: Sessao) {
  await db.from("telegram_sessoes").upsert({
    telegram_user_id: s.telegram_user_id, nome: s.nome ?? null, chat_id: s.chat_id ?? null,
    estado: s.estado ?? null, dados: s.dados ?? {}, updated_at: new Date().toISOString(),
  }, { onConflict: "telegram_user_id" });
}

const STATUS_LABEL: Record<string, string> = {
  em_estoque: "Em estoque", disponivel: "Disponível", alocado: "Alocado", em_manutencao: "Em manutenção",
  em_transito: "Em trânsito", extraviado: "Extraviado", roubado: "Roubado", danificado: "Danificado",
  baixado: "Baixado", descartado: "Descartado", vendido: "Vendido",
};
const STATUS_FORA = ["baixado", "descartado", "vendido", "extraviado", "roubado"];
const CATEGORIAS = [
  { key: "telefonia", label: "📱 Telefone" },
  { key: "veiculo", label: "🚗 Veículo" },
  { key: "equipamento_obra", label: "🏗️ Equip. de obra" },
  { key: "informatica", label: "💻 Informática" },
];
const CAT_LABEL: Record<string, string> = Object.fromEntries(CATEGORIAS.map((c) => [c.key, c.label]));

function nomeAtivo(a: any): string {
  return `${a.descricao}${a.numero_patrimonial ? ` (pat. ${a.numero_patrimonial})` : ""}`;
}
const idBaseDe = (d: any) => ({ colaborador_id: d.colaborador_id, colaborador_nome: d.colaborador_nome, colaborador_email: d.colaborador_email });

// ── Aplica a movimentação (espelha o movimentar.ts) ─────────────────────
async function aplicarMovimento(db: any, ativo: any, patchAtivo: any, movimento: any, autor: string) {
  const agora = new Date().toISOString();
  await db.from("ativos").update({ ...patchAtivo, updated_at: agora }).eq("id", ativo.id);
  await db.from("ativos_movimentos").insert({ ativo_id: ativo.id, status_anterior: ativo.status, feito_por: autor, ...movimento });
  const ident = nomeAtivo(ativo);
  const depois = movimento.status_novo as string | null;
  const mudou = !!depois && ativo.status !== depois;
  const tgStatus = mudou ? `\nStatus: ${escTg(STATUS_LABEL[ativo.status] || ativo.status)} → <b>${escTg(STATUS_LABEL[depois] || depois)}</b>` : "";
  const icone: Record<string, string> = { entrega: "🤝", devolucao: "↩️", transferencia: "🔀", ocorrencia: "⚠️" };
  enviarTelegram(`${icone[String(movimento.tipo)] || "•"} <b>Ativo — movimentação (via Telegram)</b>\n${escTg(ident)}\n<i>${escTg(String(movimento.descricao || ""))}</i>${tgStatus}\nPor ${escTg(autor)}`).catch(() => {});
}

// ── Perguntas / menus ───────────────────────────────────────────────────
function perguntarRegistrar(chatId: number, nome: string) {
  return enviar(chatId, `Olá, <b>${escTg(nome)}</b>! 👋\nVocê quer registrar uma <b>movimentação de equipamento</b>?`,
    inline([[{ text: "✅ Sim", callback_data: "reg:sim" }, { text: "❌ Não", callback_data: "reg:nao" }]]));
}
function perguntarCategoria(chatId: number) {
  return enviar(chatId, "Qual é o <b>tipo</b> do equipamento?",
    inline([...CATEGORIAS.map((c) => [{ text: c.label, callback_data: "cat:" + c.key }]), btnCancelar]));
}
function perguntarDestino(chatId: number, equipNome: string, statusAtual: string, com?: string) {
  return enviar(chatId,
    `Equipamento: <b>${escTg(equipNome)}</b>\n(situação: ${escTg(STATUS_LABEL[statusAtual] || statusAtual)}${com ? `, com ${escTg(com)}` : ""})\n\n<b>Para onde vai?</b>`,
    inline([
      [{ text: "👤 Entreguei para uma pessoa", callback_data: "dest:pessoa" }],
      [{ text: "🏗️ Levei para uma obra", callback_data: "dest:obra" }],
      [{ text: "📦 Devolvi ao estoque", callback_data: "dest:estoque" }],
      [{ text: "⚠️ Está com defeito", callback_data: "dest:defeito" }],
      btnCancelar,
    ]));
}

// ════════════════════════════════════════════════════════════════════════
export async function processarUpdate(update: any): Promise<void> {
  const db = supabaseAdmin();
  try {
    if (update?.callback_query) return await onCallback(db, update.callback_query);
    if (update?.message) return await onMessage(db, update.message);
  } catch { /* webhook sempre responde 200 */ }
}

// ── Mensagens ────────────────────────────────────────────────────────────
async function onMessage(db: any, msg: any) {
  const chat = msg.chat;
  if (!chat || chat.type !== "private") return;
  const userId = String(msg.from?.id || "");
  const chatId = chat.id;
  if (!userId) return;

  if (msg.contact) {
    if (String(msg.contact.user_id || "") !== userId) { await enviar(chatId, "Compartilhe o <b>seu próprio</b> contato, por favor.", botaoTelefone); return; }
    return await identificar(db, userId, chatId, msg.contact.phone_number);
  }

  const texto = String(msg.text || "").trim();
  const sessao = await getSessao(db, userId);
  const identificado = sessao?.dados?.colaborador_id;

  if (/^\/cancelar/i.test(texto) && sessao) {
    await salvarSessao(db, { ...sessao, estado: "pronto", dados: idBaseDe(sessao.dados || {}) });
    if (identificado) await mostrarMenu(db, chatId, sessao!.dados);
    return;
  }

  if (!identificado) {
    await enviar(chatId,
      "👋 <b>Bot de Ativos — Costa Júnior</b>\n\nPara registrar movimentações de equipamento, preciso te identificar pelo seu telefone cadastrado no sistema.\n\nToque no botão abaixo:",
      botaoTelefone);
    return;
  }

  // RH/Admin pode enviar um DOCUMENTO (foto/PDF) a qualquer momento → fluxo de anexo
  if (msg.photo || msg.document) {
    if (!(await ehRhAdmin(db, identificado))) { await enviar(chatId, "📄 O envio de documentos pelo Telegram é restrito ao RH/Admin."); return; }
    return await onDocumentoRecebido(db, sessao!, chatId, msg);
  }

  const estado = sessao?.estado || "pronto";
  if (estado === "busca_equip") return await buscarEquip(db, sessao!, chatId, texto);
  if (estado === "busca_pessoa") return await buscarPessoa(db, sessao!, chatId, texto);
  if (estado === "busca_obra") return await buscarObra(db, sessao!, chatId, texto);
  if (estado === "busca_pessoa_doc") return await buscarPessoaDoc(db, sessao!, chatId, texto);
  if (estado === "kb_aguarda") return await onTextoKb(db, sessao!, chatId, texto);
  if (estado === "kb_manual") return await onKbManual(db, sessao!, chatId, texto);
  if (estado === "doc_aguarda") { await enviar(chatId, "Me envie a <b>foto</b> ou o <b>PDF</b> do documento. 📎"); return; }

  // qualquer outra mensagem (estado pronto) → reabre o menu
  await mostrarMenu(db, chatId, sessao!.dados);
}

async function identificar(db: any, userId: string, chatId: number, telefone: string) {
  const { data: colabs } = await db.from("rh_colaboradores")
    .select("id, nome, email, telefone, telefone_pessoal, status").neq("status", "desligado").limit(3000);
  const achado = (colabs || []).find((c: any) => telBate(telefone, c.telefone) || telBate(telefone, c.telefone_pessoal));
  if (!achado) {
    await enviar(chatId, "❌ Não encontrei esse telefone no cadastro. Verifique com o RH se o seu telefone (com DDD) está na sua ficha. Depois toque em /start de novo.", tirarTeclado);
    return;
  }
  await salvarSessao(db, {
    telegram_user_id: userId, nome: achado.nome, chat_id: String(chatId), estado: "pronto",
    dados: { colaborador_id: achado.id, colaborador_nome: achado.nome, colaborador_email: achado.email || null },
  });
  await enviar(chatId, `✅ Identificado: <b>${escTg(achado.nome)}</b>!`, tirarTeclado);
  await mostrarMenu(db, chatId, { colaborador_id: achado.id, colaborador_nome: achado.nome, colaborador_email: achado.email || null });
}

async function buscarEquip(db: any, sessao: Sessao, chatId: number, termo: string) {
  if (termo.length < 2) { await enviar(chatId, "Digite ao menos 2 letras do nome ou o número de patrimônio."); return; }
  const cat = sessao.dados?.categoria;
  const t = termo.replace(/[%,()]/g, " ").trim();
  let q = db.from("ativos").select("id, descricao, numero_patrimonial, status, alocado_para_nome")
    .or(`descricao.ilike.%${t}%,numero_patrimonial.ilike.%${t}%`)
    .not("status", "in", `(${STATUS_FORA.join(",")})`).limit(8);
  if (cat) q = q.eq("categoria", cat);
  const { data: ativos } = await q;
  if (!ativos?.length) {
    await enviar(chatId, `Não achei ${CAT_LABEL[cat] || "equipamento"} com "<b>${escTg(termo)}</b>". Tente outro nome/patrimônio, ou /cancelar.`);
    return;
  }
  const linhas = ativos.map((a: any) => [{ text: `${nomeAtivo(a)} — ${STATUS_LABEL[a.status] || a.status}`.slice(0, 60), callback_data: `eq:${a.id}` }]);
  linhas.push(btnCancelar);
  await enviar(chatId, "Selecione o equipamento:", inline(linhas));
}

async function buscarPessoa(db: any, sessao: Sessao, chatId: number, termo: string) {
  if (termo.length < 2) { await enviar(chatId, "Digite ao menos 2 letras do nome da pessoa."); return; }
  const t = termo.replace(/[%,()]/g, " ").trim();
  const { data: pessoas } = await db.from("rh_colaboradores").select("id, nome").neq("status", "desligado").ilike("nome", `%${t}%`).limit(8);
  if (!pessoas?.length) { await enviar(chatId, `Não achei ninguém com "<b>${escTg(termo)}</b>". Tente outro nome, ou /cancelar.`); return; }
  const linhas = pessoas.map((p: any) => [{ text: String(p.nome).slice(0, 60), callback_data: `pess:${p.id}` }]);
  linhas.push(btnCancelar);
  await enviar(chatId, "Para quem?", inline(linhas));
}

async function buscarObra(db: any, sessao: Sessao, chatId: number, termo: string) {
  if (termo.length < 2) { await enviar(chatId, "Digite ao menos 2 letras do nome da obra."); return; }
  const t = termo.replace(/[%,()]/g, " ").trim();
  const { data: obras } = await db.from("obras").select("id, nome").ilike("nome", `%${t}%`).limit(8);
  if (!obras?.length) { await enviar(chatId, `Não achei obra com "<b>${escTg(termo)}</b>". Tente outro nome, ou /cancelar.`); return; }
  const linhas = obras.map((o: any) => [{ text: String(o.nome).slice(0, 60), callback_data: `ob:${o.id}` }]);
  linhas.push(btnCancelar);
  await enviar(chatId, "Qual obra?", inline(linhas));
}

// ── Callbacks (botões) ───────────────────────────────────────────────────
async function onCallback(db: any, cq: any) {
  const userId = String(cq.from?.id || "");
  const chatId = cq.message?.chat?.id;
  const data = String(cq.data || "");
  await responderCallback(cq.id);
  if (!userId || !chatId) return;
  const sessao = await getSessao(db, userId);
  if (!sessao?.dados?.colaborador_id) { await enviar(chatId, "Sessão expirada. Toque em /start para recomeçar.", botaoTelefone); return; }
  const dados = sessao.dados || {};
  const idBase = idBaseDe(dados);

  if (data === "cancel" || data === "reg:nao") {
    await salvarSessao(db, { ...sessao, estado: "pronto", dados: idBase });
    await enviar(chatId, data === "reg:nao" ? "Ok! Quando precisar, é só mandar uma mensagem. 👋" : "Cancelado.");
    return;
  }
  if (data === "reg:sim" || data === "menu:mov") {
    await salvarSessao(db, { ...sessao, estado: "esc_categoria", dados: idBase });
    await perguntarCategoria(chatId);
    return;
  }
  if (data === "menu:doc" || data === "menu:kb") {
    if (!(await ehRhAdmin(db, dados.colaborador_id))) { await enviar(chatId, "Recurso restrito ao RH/Admin."); return; }
    if (data === "menu:doc") {
      await salvarSessao(db, { ...sessao, estado: "doc_aguarda", dados: idBase });
      await enviar(chatId, "📄 <b>Enviar documento</b>\nMe mande a <b>foto</b> ou o <b>PDF</b> do documento (de um colaborador). Eu leio e sugiro de quem é, o tipo e a validade.");
    } else {
      await salvarSessao(db, { ...sessao, estado: "kb_aguarda", dados: idBase });
      await enviar(chatId, "📚 <b>Alimentar a base</b>\nMe mande o <b>texto/assunto</b> a cadastrar (ex.: \"o vencimento do cartão X é dia Y\"). Eu transformo em pergunta e resposta pra você confirmar.");
    }
    return;
  }
  if (data === "danex") return await anexarDoc(db, sessao, chatId);
  if (data === "dpess") {
    await salvarSessao(db, { ...sessao, estado: "busca_pessoa_doc", dados });
    await enviar(chatId, "🔎 Digite o <b>nome da pessoa</b> dona do documento:");
    return;
  }
  if (data === "dtipo") {
    const linhas = SLOTS_DOC.map((s) => [{ text: s.label.slice(0, 60), callback_data: "dslot:" + s.key }]);
    linhas.push(btnCancelar);
    await enviar(chatId, "Qual o <b>tipo</b> do documento?", inline(linhas));
    return;
  }
  if (data.startsWith("dslot:")) {
    const slot = slotPorKey(data.slice(6)) || slotPorKey("outro")!;
    const nd = { ...dados, sug_slot: slot.key, sug_slot_label: slot.label, sug_tem_validade: slot.validade };
    await salvarSessao(db, { ...sessao, estado: "doc_confirma", dados: nd });
    await cardDoc(chatId, nd);
    return;
  }
  if (data.startsWith("pdoc:")) {
    const { data: p } = await db.from("rh_colaboradores").select("id, nome").eq("id", data.slice(5)).maybeSingle();
    if (!p) { await enviar(chatId, "Pessoa não encontrada."); return; }
    const nd = { ...dados, sug_colab_id: p.id, sug_colab_nome: p.nome };
    await salvarSessao(db, { ...sessao, estado: "doc_confirma", dados: nd });
    await cardDoc(chatId, nd);
    return;
  }
  if (data === "kbsave") return await salvarKb(db, sessao, chatId);
  if (data.startsWith("cat:")) {
    const cat = data.slice(4);
    await salvarSessao(db, { ...sessao, estado: "busca_equip", dados: { ...idBase, categoria: cat } });
    await enviar(chatId, `🔎 Digite o <b>nome</b> ou o <b>patrimônio</b> do equipamento (${CAT_LABEL[cat] || ""}) que você movimentou:`);
    return;
  }
  if (data.startsWith("eq:")) {
    const { data: ativo } = await db.from("ativos").select("id, descricao, numero_patrimonial, status, alocado_para_tipo, alocado_para_id, alocado_para_nome").eq("id", data.slice(3)).maybeSingle();
    if (!ativo) { await enviar(chatId, "Equipamento não encontrado. /cancelar e tente de novo."); return; }
    await salvarSessao(db, { ...sessao, estado: "esc_destino", dados: { ...dados, equip_id: ativo.id, equip_nome: nomeAtivo(ativo) } });
    await perguntarDestino(chatId, nomeAtivo(ativo), ativo.status, ativo.alocado_para_nome);
    return;
  }
  if (data === "dest:estoque" || data === "dest:defeito") {
    const acao = data === "dest:estoque" ? "devolver" : "defeito";
    await salvarSessao(db, { ...sessao, estado: "mov_confirma", dados: { ...dados, acao } });
    const txt = acao === "devolver"
      ? `Confirma: <b>${escTg(dados.equip_nome)}</b> foi <b>devolvido ao estoque</b>?`
      : `Confirma: <b>${escTg(dados.equip_nome)}</b> está <b>com defeito</b> (vai para conserto)?`;
    await enviar(chatId, txt, inline([[{ text: "✅ Confirmar", callback_data: "ok" }], btnCancelar]));
    return;
  }
  if (data === "dest:pessoa") {
    await salvarSessao(db, { ...sessao, estado: "busca_pessoa", dados: { ...dados, acao: "entregar" } });
    await enviar(chatId, "🔎 Digite o <b>nome da pessoa</b> para quem você entregou:");
    return;
  }
  if (data === "dest:obra") {
    await salvarSessao(db, { ...sessao, estado: "busca_obra", dados: { ...dados, acao: "obra" } });
    await enviar(chatId, "🔎 Digite o <b>nome da obra</b> para onde você levou:");
    return;
  }
  if (data.startsWith("pess:")) {
    const { data: p } = await db.from("rh_colaboradores").select("id, nome").eq("id", data.slice(5)).maybeSingle();
    if (!p) { await enviar(chatId, "Pessoa não encontrada. /cancelar e tente de novo."); return; }
    await salvarSessao(db, { ...sessao, estado: "mov_confirma", dados: { ...dados, acao: "entregar", destino_id: p.id, destino_nome: p.nome } });
    await enviar(chatId, `Confirma: <b>${escTg(dados.equip_nome)}</b> foi <b>entregue para ${escTg(p.nome)}</b>?`, inline([[{ text: "✅ Confirmar", callback_data: "ok" }], btnCancelar]));
    return;
  }
  if (data.startsWith("ob:")) {
    const { data: o } = await db.from("obras").select("id, nome").eq("id", data.slice(3)).maybeSingle();
    if (!o) { await enviar(chatId, "Obra não encontrada. /cancelar e tente de novo."); return; }
    await salvarSessao(db, { ...sessao, estado: "mov_confirma", dados: { ...dados, acao: "obra", destino_id: o.id, destino_nome: o.nome } });
    await enviar(chatId, `Confirma: <b>${escTg(dados.equip_nome)}</b> foi levado para a obra <b>${escTg(o.nome)}</b>?`, inline([[{ text: "✅ Confirmar", callback_data: "ok" }], btnCancelar]));
    return;
  }
  if (data === "ok") return await confirmar(db, sessao, chatId);
}

async function confirmar(db: any, sessao: Sessao, chatId: number) {
  const d = sessao.dados || {};
  if (!d.equip_id || !d.acao) { await enviar(chatId, "Faltou informação. Recomece mandando uma mensagem."); return; }
  const { data: ativo } = await db.from("ativos").select("*").eq("id", d.equip_id).maybeSingle();
  if (!ativo) { await enviar(chatId, "Equipamento não encontrado."); return; }
  const autor = `${d.colaborador_nome}${d.colaborador_email ? ` <${d.colaborador_email}>` : ""} (via Telegram)`;

  if (d.acao === "entregar") {
    await aplicarMovimento(db, ativo,
      { status: "alocado", alocado_para_tipo: "colaborador", alocado_para_id: d.destino_id, alocado_para_nome: d.destino_nome },
      { tipo: "entrega", descricao: `Entregue para ${d.destino_nome} — reportado via Telegram por ${d.colaborador_nome}`,
        de_tipo: ativo.alocado_para_tipo, de_id: ativo.alocado_para_id, de_nome: ativo.alocado_para_nome,
        para_tipo: "colaborador", para_id: d.destino_id, para_nome: d.destino_nome, status_novo: "alocado" }, autor);
  } else if (d.acao === "obra") {
    await aplicarMovimento(db, ativo,
      { status: "alocado", alocado_para_tipo: "obra", alocado_para_id: d.destino_id || null, alocado_para_nome: d.destino_nome },
      { tipo: "transferencia", descricao: `Transferido para a obra ${d.destino_nome} — reportado via Telegram por ${d.colaborador_nome}`,
        de_tipo: ativo.alocado_para_tipo, de_id: ativo.alocado_para_id, de_nome: ativo.alocado_para_nome,
        para_tipo: "obra", para_id: d.destino_id || null, para_nome: d.destino_nome, status_novo: "alocado" }, autor);
  } else if (d.acao === "devolver") {
    await aplicarMovimento(db, ativo,
      { status: "em_estoque", alocado_para_tipo: null, alocado_para_id: null, alocado_para_nome: null },
      { tipo: "devolucao", descricao: `Devolvido ao estoque${ativo.alocado_para_nome ? ` (estava com ${ativo.alocado_para_nome})` : ""} — via Telegram por ${d.colaborador_nome}`,
        de_tipo: ativo.alocado_para_tipo, de_id: ativo.alocado_para_id, de_nome: ativo.alocado_para_nome, status_novo: "em_estoque" }, autor);
    if (ativo.alocado_para_tipo === "colaborador") await db.from("ativos_termos").update({ status: "cancelado" }).eq("ativo_id", ativo.id).neq("status", "cancelado");
  } else if (d.acao === "defeito") {
    await db.from("ativos_ocorrencias").insert({ ativo_id: ativo.id, tipo: "dano", data_ocorrencia: new Date().toISOString().slice(0, 10), descricao: `Defeito reportado via Telegram por ${d.colaborador_nome}`, criado_por: autor });
    await aplicarMovimento(db, ativo, { status: "danificado" },
      { tipo: "ocorrencia", descricao: `Ocorrência (dano): defeito reportado via Telegram por ${d.colaborador_nome}`, status_novo: "danificado" }, autor);
  }

  await enviar(chatId, `✅ <b>Equipamento movimentado com sucesso!</b>\n${escTg(nomeAtivo(ativo))} foi atualizado na base. Obrigado! 🙌`,
    inline([[{ text: "📦 Registrar outra", callback_data: "reg:sim" }]]));
  await salvarSessao(db, { ...sessao, estado: "pronto", dados: idBaseDe(d) });
}

// ════════════════════════════════════════════════════════════════════════
// DOCUMENTOS + BASE DE CONHECIMENTO pelo Telegram (só RH/Admin).
// Reaproveita o "cérebro" da Caixa de Entrada (slotsDoc + llm).
// ════════════════════════════════════════════════════════════════════════

// Só quem tem perfil admin/rh (resolvido pelo vínculo rh_colaboradores → portal_profiles).
async function ehRhAdmin(db: any, colaboradorId: string): Promise<boolean> {
  try {
    if (!colaboradorId) return false;
    const { data: c } = await db.from("rh_colaboradores").select("profile_id").eq("id", colaboradorId).maybeSingle();
    if (!c?.profile_id) return false;
    const { data: p } = await db.from("portal_profiles").select("role, roles").eq("id", c.profile_id).maybeSingle();
    const roles = [p?.role, ...(Array.isArray(p?.roles) ? p.roles : [])].filter(Boolean);
    return roles.includes("admin") || roles.includes("rh");
  } catch { return false; }
}

async function mostrarMenu(db: any, chatId: number, dados: any) {
  const nome = dados?.colaborador_nome || "colega";
  const linhas: { text: string; callback_data: string }[][] = [[{ text: "📦 Movimentar equipamento", callback_data: "menu:mov" }]];
  if (await ehRhAdmin(db, dados?.colaborador_id)) {
    linhas.push([{ text: "📄 Enviar documento (RH)", callback_data: "menu:doc" }]);
    linhas.push([{ text: "📚 Alimentar a base (RH)", callback_data: "menu:kb" }]);
  }
  await enviar(chatId, `Olá, <b>${escTg(nome)}</b>! 👋\nO que você quer fazer?`, inline(linhas));
}

// Baixa o conteúdo de um arquivo do Telegram (getFile → download).
async function baixarArquivoTg(fileId: string): Promise<Buffer | null> {
  if (!TOKEN) return null;
  try {
    const f = await tg("getFile", { file_id: fileId });
    const path = f?.result?.file_path;
    if (!path) return null;
    const r = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${path}`);
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch { return null; }
}

const autorDe = (d: any) => `${d.colaborador_nome}${d.colaborador_email ? ` <${d.colaborador_email}>` : ""} (via Telegram)`;

async function onDocumentoRecebido(db: any, sessao: Sessao, chatId: number, msg: any) {
  await enviar(chatId, "📎 Recebi! Analisando o documento… ⏳");
  let fileId = "", nome = "documento", ct = "application/octet-stream";
  if (msg.document) { fileId = msg.document.file_id; nome = msg.document.file_name || "documento"; ct = msg.document.mime_type || "application/octet-stream"; }
  else if (msg.photo?.length) { fileId = msg.photo[msg.photo.length - 1].file_id; nome = "foto-telegram.jpg"; ct = "image/jpeg"; }
  if (!fileId) { await enviar(chatId, "Não consegui ler esse arquivo. Envie como foto ou PDF."); return; }

  const ctL = ct.toLowerCase();
  const tipoOk = ctL === "application/pdf" || ctL.startsWith("image/") || ctL.includes("word") || ctL.includes("officedocument") || /\.(pdf|jpg|jpeg|png|webp|doc|docx)$/i.test(nome);
  if (!tipoOk) { await enviar(chatId, "❌ Formato não aceito — envie PDF, foto ou Word."); return; }

  const buf = await baixarArquivoTg(fileId);
  if (!buf) { await enviar(chatId, "❌ Não consegui baixar o arquivo. Tente enviar de novo."); return; }
  if (buf.length > 18 * 1024 * 1024) { await enviar(chatId, "❌ Arquivo muito grande (máx. ~18 MB)."); return; }

  let ext = (nome.includes(".") ? nome.split(".").pop() : "")?.toLowerCase().replace(/[^a-z0-9]/g, "") || "";
  if (!ext || ext.length > 5) ext = ctL.includes("pdf") ? "pdf" : ctL.startsWith("image/") ? "jpg" : "bin";
  const storagePath = `inbox/tg-${Date.now()}.${ext}`;
  const { error: errUp } = await db.storage.from("rh").upload(storagePath, buf, { contentType: ct, upsert: false });
  if (errUp) { await enviar(chatId, "❌ Falha ao guardar o arquivo: " + escTg(errUp.message)); return; }

  // sugestão: nome do arquivo + (se houver Gemini) leitura do documento
  const { data: colabs } = await db.from("rh_colaboradores").select("id, nome").neq("status", "desligado").limit(3000);
  const lista = (colabs || []).map((c: any) => ({ id: c.id, nome: c.nome }));
  let slotKey = detectarSlotPorTexto(nome);
  let validade = detectarValidade(nome);
  let match = casarColaborador(nome, lista);
  let ia = false;
  if (geminiConfigurado() && (ctL === "application/pdf" || ctL.startsWith("image/"))) {
    try {
      const system = `Você lê um documento de RH de um colaborador da construtora Costa Júnior e extrai metadados. Responda APENAS JSON: {"nome_pessoa":"nome completo ou vazio","tipo":"um de: ASO, CNH, RG, Contrato, CTPS, Titulo de Eleitor, Certidao, Comprovante de Residencia, NR-35, NR-10, NR-06, NR-01, Advertencia, Suspensao, Ordem de Servico, Outro","validade":"AAAA-MM-DD ou vazio"}`;
      const raw = await lerDocumentoGemini(system, "Extraia os metadados deste documento.", buf.toString("base64"), ct);
      const o = raw ? extrairJson(raw) : null;
      if (o) {
        ia = true;
        const si = detectarSlotPorTexto(String(o.tipo || "")); if (si) slotKey = si;
        if (o.validade && /^\d{4}-\d{2}-\d{2}$/.test(String(o.validade).trim())) validade = String(o.validade).trim();
        if (o.nome_pessoa) { const m2 = casarColaborador(String(o.nome_pessoa), lista); if (m2 && (!match || m2.score >= match.score)) match = m2; }
      }
    } catch { /* IA falhou → segue pela heurística do nome */ }
  }
  const slot = (slotKey && slotPorKey(slotKey)) || slotPorKey("outro")!;
  const nd = {
    ...idBaseDe(sessao.dados || {}), doc_path: storagePath, doc_nome: nome,
    sug_colab_id: match?.id || null, sug_colab_nome: match?.nome || null,
    sug_slot: slot.key, sug_slot_label: slot.label, sug_tem_validade: slot.validade,
    sug_validade: validade || null, ia,
  };
  await salvarSessao(db, { ...sessao, estado: "doc_confirma", dados: nd });
  await cardDoc(chatId, nd);
}

async function cardDoc(chatId: number, d: any) {
  const pessoa = d.sug_colab_nome ? `<b>${escTg(d.sug_colab_nome)}</b>` : "<i>(não identifiquei a pessoa)</i>";
  const venc = d.sug_tem_validade ? `\nValidade: ${d.sug_validade ? escTg(d.sug_validade) : "<i>não detectei</i>"}` : "";
  const origem = d.ia ? "🔮 li o documento" : "📄 sugerido pelo nome do arquivo";
  const linhas: { text: string; callback_data: string }[][] = [];
  if (d.sug_colab_id) linhas.push([{ text: "✅ Anexar na ficha", callback_data: "danex" }]);
  linhas.push([{ text: "👤 Trocar pessoa", callback_data: "dpess" }, { text: "🏷️ Trocar tipo", callback_data: "dtipo" }]);
  linhas.push(btnCancelar);
  await enviar(chatId,
    `📎 <b>${escTg(d.doc_nome)}</b> (${origem})\n\nPessoa: ${pessoa}\nTipo: <b>${escTg(d.sug_slot_label)}</b>${venc}\n\n${d.sug_colab_id ? "Confirma?" : "Toque em <b>Trocar pessoa</b> pra escolher de quem é."}`,
    inline(linhas));
}

async function buscarPessoaDoc(db: any, sessao: Sessao, chatId: number, termo: string) {
  if (termo.length < 2) { await enviar(chatId, "Digite ao menos 2 letras do nome."); return; }
  const t = termo.replace(/[%,()]/g, " ").trim();
  const { data: pessoas } = await db.from("rh_colaboradores").select("id, nome").neq("status", "desligado").ilike("nome", `%${t}%`).limit(8);
  if (!pessoas?.length) { await enviar(chatId, `Não achei ninguém com "<b>${escTg(termo)}</b>". Tente outro nome, ou /cancelar.`); return; }
  const linhas = pessoas.map((p: any) => [{ text: String(p.nome).slice(0, 60), callback_data: "pdoc:" + p.id }]);
  linhas.push(btnCancelar);
  await enviar(chatId, "De quem é o documento?", inline(linhas));
}

async function anexarDoc(db: any, sessao: Sessao, chatId: number) {
  const d = sessao.dados || {};
  if (!d.doc_path || !d.sug_colab_id) { await enviar(chatId, "Faltou a pessoa. Toque em 👤 Trocar pessoa."); return; }
  const slot = slotPorKey(d.sug_slot) || slotPorKey("outro")!;
  const validade = d.sug_tem_validade ? (d.sug_validade || null) : null;
  const titulo = `${slot.prefixo} — ${d.doc_nome}`.slice(0, 200);
  const autor = autorDe(d);
  const { data: row, error } = await db.from("rh_documentos").insert({
    colaborador_id: d.sug_colab_id, titulo, tipo: slot.tipo, storage_path: d.doc_path,
    validade, validade_na: !d.sug_tem_validade, criado_por: autor,
  }).select().single();
  if (error) { await enviar(chatId, "❌ Não consegui anexar: " + escTg(error.message)); return; }
  await registrarAcao(db, { req: undefined as any, admin: { email: autor } as any }, {
    acao: "criar", entidade: "rh_documentos", registro_id: row?.id ?? null,
    descricao: `Telegram: anexou "${slot.label}" a ${d.sug_colab_nome}`, dados: { tipo: slot.tipo, validade },
  });
  await enviar(chatId, `✅ <b>Anexado!</b>\n${escTg(slot.label)} → ficha de <b>${escTg(d.sug_colab_nome)}</b>. 🙌`,
    inline([[{ text: "📄 Enviar outro", callback_data: "menu:doc" }]]));
  await salvarSessao(db, { ...sessao, estado: "pronto", dados: idBaseDe(d) });
}

async function onTextoKb(db: any, sessao: Sessao, chatId: number, texto: string) {
  if (texto.length < 5) { await enviar(chatId, "Mande um texto um pouco maior pra eu entender o assunto. 🙂"); return; }
  let pergunta = "", resposta = "", categoria = "Geral";
  if (llmConfigurado()) {
    await enviar(chatId, "✨ Organizando… ⏳");
    try {
      const system = `Você organiza conhecimento interno da Costa Júnior Engenharia para um FAQ (a JunIA usa). A partir de um texto livre, gere UMA pergunta clara (como um colaborador perguntaria) e a resposta, em português, objetivo. Não invente além do texto. Responda APENAS JSON: {"pergunta":"...","resposta":"...","categoria":"Geral|Operacional|RH|Financeiro|Comercial|Administrativo"}`;
      const raw = await gerarTextoLLM(system, [{ role: "user", content: texto.slice(0, 4000) }]);
      const o = raw ? extrairJson(raw) : null;
      if (o && o.resposta) { pergunta = String(o.pergunta || "").trim(); resposta = String(o.resposta || "").trim(); categoria = String(o.categoria || "Geral").trim() || "Geral"; }
    } catch { /* cai no manual */ }
  }
  if (!resposta) {
    await salvarSessao(db, { ...sessao, estado: "kb_manual", dados: idBaseDe(sessao.dados || {}) });
    await enviar(chatId, "Não consegui organizar com a IA agora. Me mande no formato:\n<b>Pergunta | Resposta</b>\n(ex.: Qual o prazo do Santander? | 5 dias úteis)");
    return;
  }
  const nd = { ...idBaseDe(sessao.dados || {}), kb_pergunta: pergunta, kb_resposta: resposta, kb_categoria: categoria };
  await salvarSessao(db, { ...sessao, estado: "kb_confirma", dados: nd });
  await enviar(chatId,
    `📚 Vou cadastrar na base:\n\n<b>P:</b> ${escTg(pergunta)}\n<b>R:</b> ${escTg(resposta)}\n<b>Categoria:</b> ${escTg(categoria)}`,
    inline([[{ text: "✅ Salvar", callback_data: "kbsave" }], [{ text: "✏️ Reescrever (mande de novo)", callback_data: "menu:kb" }], btnCancelar]));
}

async function onKbManual(db: any, sessao: Sessao, chatId: number, texto: string) {
  const i = texto.indexOf("|");
  if (i < 1) { await enviar(chatId, "Use o formato <b>Pergunta | Resposta</b>."); return; }
  const pergunta = texto.slice(0, i).trim(), resposta = texto.slice(i + 1).trim();
  if (!pergunta || !resposta) { await enviar(chatId, "Faltou a pergunta ou a resposta."); return; }
  const nd = { ...idBaseDe(sessao.dados || {}), kb_pergunta: pergunta, kb_resposta: resposta, kb_categoria: "Geral" };
  await salvarSessao(db, { ...sessao, estado: "kb_confirma", dados: nd });
  await enviar(chatId, `📚 Vou cadastrar:\n<b>P:</b> ${escTg(pergunta)}\n<b>R:</b> ${escTg(resposta)}`, inline([[{ text: "✅ Salvar", callback_data: "kbsave" }], btnCancelar]));
}

async function salvarKb(db: any, sessao: Sessao, chatId: number) {
  const d = sessao.dados || {};
  if (!d.kb_pergunta || !d.kb_resposta) { await enviar(chatId, "Faltou conteúdo. Recomece em 📚 Alimentar a base."); return; }
  const autor = autorDe(d);
  const { data: row, error } = await db.from("portal_kb").insert({ question: d.kb_pergunta, answer: d.kb_resposta, category: d.kb_categoria || "Geral" }).select().single();
  if (error) { await enviar(chatId, "❌ Não consegui salvar: " + escTg(error.message)); return; }
  await registrarAcao(db, { req: undefined as any, admin: { email: autor } as any }, {
    acao: "criar", entidade: "portal_kb", registro_id: row?.id ?? null,
    descricao: `Telegram: adicionou à base "${String(d.kb_pergunta).slice(0, 80)}"`, dados: { category: d.kb_categoria },
  });
  await enviar(chatId, "✅ <b>Salvo na base!</b> Já vale na JunIA. 🤖", inline([[{ text: "📚 Cadastrar outro", callback_data: "menu:kb" }]]));
  await salvarSessao(db, { ...sessao, estado: "pronto", dados: idBaseDe(d) });
}
