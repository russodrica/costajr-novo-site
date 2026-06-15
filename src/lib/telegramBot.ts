// ════════════════════════════════════════════════════════════════════════
// Bot INBOUND do Telegram (@cjr_ativo_bot) — "caminho de volta".
// Alguém do time abre o PRIVADO do bot, se identifica pelo TELEFONE cadastrado
// e registra a movimentação de um equipamento por um fluxo guiado (botões).
// SEM LLM — é uma máquina de estados simples (estado/dados em telegram_sessoes).
// O token é o do bot de Ativos (TELEGRAM_BOT_TOKEN).
// ════════════════════════════════════════════════════════════════════════
import { supabaseAdmin } from "./supabase";
import { enviarTelegram, escTg } from "./telegram";

function envVar(name: string): string {
  return (import.meta.env as any)[name] || (process.env as any)[name] || "";
}
const TOKEN = envVar("TELEGRAM_BOT_TOKEN"); // bot de Ativos

// ── Telegram API helpers (best-effort) ──────────────────────────────────
async function tg(metodo: string, corpo: any): Promise<any> {
  if (!TOKEN) return { ok: false, motivo: "sem token" };
  try {
    const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${metodo}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo),
    });
    return await r.json().catch(() => ({}));
  } catch (e: any) { return { ok: false, motivo: String(e?.message || e) }; }
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

// ── Telefone: normalização e match tolerante ────────────────────────────
function soDigitos(s: unknown): string { return String(s ?? "").replace(/\D/g, ""); }
function normalizaTel(s: unknown): string {
  let d = soDigitos(s);
  if (d.startsWith("55") && d.length > 11) d = d.slice(2); // tira DDI Brasil
  d = d.replace(/^0+/, "");
  return d;
}
function telBate(a: unknown, b: unknown): boolean {
  const x = normalizaTel(a), y = normalizaTel(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const ux = x.slice(-8), uy = y.slice(-8); // últimos 8 (número local) como fallback
  return ux.length === 8 && ux === uy;
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
// só equipamentos "vivos" aparecem na busca do bot
const STATUS_FORA = ["baixado", "descartado", "vendido", "extraviado", "roubado"];

function nomeAtivo(a: any): string {
  return `${a.descricao}${a.numero_patrimonial ? ` (pat. ${a.numero_patrimonial})` : ""}`;
}

// ── Aplica a movimentação (espelha a lógica do movimentar.ts) ───────────
async function aplicarMovimento(db: any, ativo: any, patchAtivo: any, movimento: any, autor: string) {
  const agora = new Date().toISOString();
  await db.from("ativos").update({ ...patchAtivo, updated_at: agora }).eq("id", ativo.id);
  await db.from("ativos_movimentos").insert({
    ativo_id: ativo.id, status_anterior: ativo.status, feito_por: autor, ...movimento,
  });
  // Notifica o grupo de Ativos (mesma vitrine das movimentações feitas no admin)
  const ident = nomeAtivo(ativo);
  const depois = movimento.status_novo as string | null;
  const mudou = !!depois && ativo.status !== depois;
  const tgStatus = mudou ? `\nStatus: ${escTg(STATUS_LABEL[ativo.status] || ativo.status)} → <b>${escTg(STATUS_LABEL[depois] || depois)}</b>` : "";
  const icone: Record<string, string> = { devolucao: "↩️", transferencia: "🔀", ocorrencia: "⚠️" };
  enviarTelegram(
    `${icone[String(movimento.tipo)] || "•"} <b>Ativo — movimentação (via Telegram)</b>\n${escTg(ident)}\n<i>${escTg(String(movimento.descricao || ""))}</i>${tgStatus}\nPor ${escTg(autor)}`
  ).catch(() => { /* best-effort */ });
}

// ── Texto de ajuda / menu ───────────────────────────────────────────────
const MENU = inline([[{ text: "📦 Registrar movimentação", callback_data: "menu_mov" }]]);
function menuMsg(nome: string) {
  return `Olá, <b>${escTg(nome)}</b>! 👋\nO que você quer fazer?`;
}

// ════════════════════════════════════════════════════════════════════════
// Entrada principal: processa um update do Telegram.
// ════════════════════════════════════════════════════════════════════════
export async function processarUpdate(update: any): Promise<void> {
  const db = supabaseAdmin();
  try {
    if (update?.callback_query) return await onCallback(db, update.callback_query);
    if (update?.message) return await onMessage(db, update.message);
  } catch (e) { /* nunca propaga — webhook sempre responde 200 */ }
}

// ── Mensagens (texto / contato / comandos) ──────────────────────────────
async function onMessage(db: any, msg: any) {
  const chat = msg.chat;
  if (!chat || chat.type !== "private") return; // só conversa no privado
  const userId = String(msg.from?.id || "");
  const chatId = chat.id;
  if (!userId) return;

  // 1) Compartilhou o contato → identifica pelo telefone
  if (msg.contact) {
    if (String(msg.contact.user_id || "") !== userId) {
      await enviar(chatId, "Compartilhe o <b>seu próprio</b> contato, por favor.", botaoTelefone);
      return;
    }
    return await identificar(db, userId, chatId, msg.contact.phone_number, msg.from?.first_name);
  }

  const texto = String(msg.text || "").trim();
  const sessao = await getSessao(db, userId);
  const identificado = sessao?.dados?.colaborador_id;

  // comandos globais
  if (/^\/cancelar/i.test(texto)) {
    if (sessao) await salvarSessao(db, { ...sessao, estado: "pronto", dados: { colaborador_id: sessao.dados?.colaborador_id, colaborador_nome: sessao.dados?.colaborador_nome, colaborador_email: sessao.dados?.colaborador_email } });
    await enviar(chatId, "Ok, cancelado.", identificado ? MENU : undefined);
    return;
  }

  // ainda não identificado → pede o telefone
  if (!identificado) {
    await enviar(chatId,
      "👋 <b>Bot de Ativos — Costa Júnior</b>\n\nPara registrar movimentações de equipamento, preciso te identificar pelo seu telefone cadastrado no sistema.\n\nToque no botão abaixo para compartilhar seu telefone:",
      botaoTelefone);
    return;
  }

  // identificado → fluxo por estado
  const estado = sessao?.estado || "pronto";
  if (estado === "mov_busca_equip") return await buscarEquip(db, sessao!, chatId, texto);
  if (estado === "mov_busca_obra") return await buscarObra(db, sessao!, chatId, texto);

  // qualquer outra coisa → mostra o menu
  await enviar(chatId, menuMsg(sessao!.dados.colaborador_nome || "colega"), MENU);
}

async function identificar(db: any, userId: string, chatId: number, telefone: string, firstName?: string) {
  const { data: colabs } = await db.from("rh_colaboradores")
    .select("id, nome, email, telefone, telefone_pessoal, status")
    .neq("status", "desligado").limit(3000);
  const achado = (colabs || []).find((c: any) => telBate(telefone, c.telefone) || telBate(telefone, c.telefone_pessoal));
  if (!achado) {
    await enviar(chatId,
      "❌ Não encontrei esse telefone no cadastro de colaboradores.\n\nVerifique com o RH se o seu telefone está cadastrado na sua ficha (campo Telefone empresa ou pessoal). Depois é só tocar em /start de novo.",
      tirarTeclado);
    return;
  }
  await salvarSessao(db, {
    telegram_user_id: userId, nome: achado.nome, chat_id: String(chatId), estado: "pronto",
    dados: { colaborador_id: achado.id, colaborador_nome: achado.nome, colaborador_email: achado.email || null },
  });
  await enviar(chatId, `✅ Identificado: <b>${escTg(achado.nome)}</b>!`, tirarTeclado);
  await enviar(chatId, menuMsg(achado.nome), MENU);
}

async function buscarEquip(db: any, sessao: Sessao, chatId: number, termo: string) {
  if (termo.length < 2) { await enviar(chatId, "Digite ao menos 2 letras do nome ou o número de patrimônio."); return; }
  const t = termo.replace(/[%,()]/g, " ").trim();
  const { data: ativos } = await db.from("ativos")
    .select("id, descricao, numero_patrimonial, status, alocado_para_nome")
    .or(`descricao.ilike.%${t}%,numero_patrimonial.ilike.%${t}%`)
    .not("status", "in", `(${STATUS_FORA.join(",")})`)
    .limit(8);
  if (!ativos?.length) {
    await enviar(chatId, `Não achei equipamento com "<b>${escTg(termo)}</b>". Tente outro nome/patrimônio, ou /cancelar.`);
    return;
  }
  const linhas = ativos.map((a: any) => [{ text: `${nomeAtivo(a)} — ${STATUS_LABEL[a.status] || a.status}`.slice(0, 60), callback_data: `eq:${a.id}` }]);
  linhas.push(btnCancelar);
  await enviar(chatId, "Selecione o equipamento:", inline(linhas));
}

async function buscarObra(db: any, sessao: Sessao, chatId: number, termo: string) {
  if (termo.length < 2) { await enviar(chatId, "Digite ao menos 2 letras do nome da obra."); return; }
  const t = termo.replace(/[%,()]/g, " ").trim();
  const { data: obras } = await db.from("obras").select("id, nome").ilike("nome", `%${t}%`).limit(8);
  if (!obras?.length) {
    await enviar(chatId, `Não achei obra com "<b>${escTg(termo)}</b>". Tente outro nome, ou /cancelar.`);
    return;
  }
  const linhas = obras.map((o: any) => [{ text: String(o.nome).slice(0, 60), callback_data: `ob:${o.id}` }]);
  linhas.push(btnCancelar);
  await enviar(chatId, "Para qual obra?", inline(linhas));
}

// ── Callbacks (botões) ──────────────────────────────────────────────────
async function onCallback(db: any, cq: any) {
  const userId = String(cq.from?.id || "");
  const chatId = cq.message?.chat?.id;
  const data = String(cq.data || "");
  await responderCallback(cq.id);
  if (!userId || !chatId) return;
  const sessao = await getSessao(db, userId);
  if (!sessao?.dados?.colaborador_id) { await enviar(chatId, "Sessão expirada. Toque em /start para recomeçar.", botaoTelefone); return; }
  const dados = sessao.dados || {};
  const idBase = { colaborador_id: dados.colaborador_id, colaborador_nome: dados.colaborador_nome, colaborador_email: dados.colaborador_email };

  if (data === "cancel") {
    await salvarSessao(db, { ...sessao, estado: "pronto", dados: idBase });
    await enviar(chatId, "Cancelado.", MENU);
    return;
  }
  if (data === "menu_mov") {
    await salvarSessao(db, { ...sessao, estado: "mov_busca_equip", dados: idBase });
    await enviar(chatId, "🔎 Digite o <b>nome</b> ou o <b>número de patrimônio</b> do equipamento que você movimentou:");
    return;
  }
  if (data.startsWith("eq:")) {
    const id = data.slice(3);
    const { data: ativo } = await db.from("ativos").select("id, descricao, numero_patrimonial, status, alocado_para_tipo, alocado_para_id, alocado_para_nome").eq("id", id).maybeSingle();
    if (!ativo) { await enviar(chatId, "Equipamento não encontrado. /cancelar e tente de novo."); return; }
    await salvarSessao(db, { ...sessao, estado: "mov_acao", dados: { ...idBase, equip_id: ativo.id, equip_nome: nomeAtivo(ativo) } });
    const acoes = inline([
      [{ text: "↩️ Devolvi ao estoque", callback_data: "ac:devolver" }],
      [{ text: "🏗️ Levei para uma obra", callback_data: "ac:obra" }],
      [{ text: "⚠️ Está com defeito", callback_data: "ac:defeito" }],
      btnCancelar,
    ]);
    await enviar(chatId, `Equipamento: <b>${escTg(nomeAtivo(ativo))}</b>\n(situação atual: ${escTg(STATUS_LABEL[ativo.status] || ativo.status)}${ativo.alocado_para_nome ? `, com ${escTg(ativo.alocado_para_nome)}` : ""})\n\nO que aconteceu?`, acoes);
    return;
  }
  if (data === "ac:devolver" || data === "ac:defeito") {
    const acao = data.slice(3);
    await salvarSessao(db, { ...sessao, estado: "mov_confirma", dados: { ...dados, acao } });
    const txt = acao === "devolver"
      ? `Confirma: <b>${escTg(dados.equip_nome)}</b> foi <b>devolvido ao estoque</b>?`
      : `Confirma: <b>${escTg(dados.equip_nome)}</b> está <b>com defeito</b> (vai para conserto)?`;
    await enviar(chatId, txt, inline([[{ text: "✅ Confirmar", callback_data: "ok" }], btnCancelar]));
    return;
  }
  if (data === "ac:obra") {
    await salvarSessao(db, { ...sessao, estado: "mov_busca_obra", dados: { ...dados, acao: "obra" } });
    await enviar(chatId, "🔎 Digite o <b>nome da obra</b> para onde você levou o equipamento:");
    return;
  }
  if (data.startsWith("ob:")) {
    const obraId = data.slice(3);
    const { data: obra } = await db.from("obras").select("id, nome").eq("id", obraId).maybeSingle();
    if (!obra) { await enviar(chatId, "Obra não encontrada. /cancelar e tente de novo."); return; }
    await salvarSessao(db, { ...sessao, estado: "mov_confirma", dados: { ...dados, acao: "obra", obra_id: obra.id, obra_nome: obra.nome } });
    await enviar(chatId, `Confirma: <b>${escTg(dados.equip_nome)}</b> foi levado para a obra <b>${escTg(obra.nome)}</b>?`, inline([[{ text: "✅ Confirmar", callback_data: "ok" }], btnCancelar]));
    return;
  }
  if (data === "ok") return await confirmar(db, sessao, chatId);
}

async function confirmar(db: any, sessao: Sessao, chatId: number) {
  const d = sessao.dados || {};
  if (!d.equip_id || !d.acao) { await enviar(chatId, "Faltou informação. Recomece pelo menu.", MENU); return; }
  const { data: ativo } = await db.from("ativos").select("*").eq("id", d.equip_id).maybeSingle();
  if (!ativo) { await enviar(chatId, "Equipamento não encontrado.", MENU); return; }
  const autor = `${d.colaborador_nome}${d.colaborador_email ? ` <${d.colaborador_email}>` : ""} (via Telegram)`;
  const idBase = { colaborador_id: d.colaborador_id, colaborador_nome: d.colaborador_nome, colaborador_email: d.colaborador_email };

  if (d.acao === "devolver") {
    await aplicarMovimento(db, ativo,
      { status: "em_estoque", alocado_para_tipo: null, alocado_para_id: null, alocado_para_nome: null },
      { tipo: "devolucao", descricao: `Devolvido ao estoque${ativo.alocado_para_nome ? ` (estava com ${ativo.alocado_para_nome})` : ""} — reportado via Telegram por ${d.colaborador_nome}`,
        de_tipo: ativo.alocado_para_tipo, de_id: ativo.alocado_para_id, de_nome: ativo.alocado_para_nome, status_novo: "em_estoque" },
      autor);
    if (ativo.alocado_para_tipo === "colaborador") {
      await db.from("ativos_termos").update({ status: "cancelado" }).eq("ativo_id", ativo.id).neq("status", "cancelado");
    }
    await enviar(chatId, `✅ Registrado! <b>${escTg(nomeAtivo(ativo))}</b> voltou para o <b>estoque</b>. Obrigado!`, MENU);
  } else if (d.acao === "obra") {
    await aplicarMovimento(db, ativo,
      { status: "alocado", alocado_para_tipo: "obra", alocado_para_id: d.obra_id || null, alocado_para_nome: d.obra_nome },
      { tipo: "transferencia", descricao: `Transferido para a obra ${d.obra_nome} — reportado via Telegram por ${d.colaborador_nome}`,
        de_tipo: ativo.alocado_para_tipo, de_id: ativo.alocado_para_id, de_nome: ativo.alocado_para_nome,
        para_tipo: "obra", para_id: d.obra_id || null, para_nome: d.obra_nome, status_novo: "alocado" },
      autor);
    await enviar(chatId, `✅ Registrado! <b>${escTg(nomeAtivo(ativo))}</b> agora está na obra <b>${escTg(d.obra_nome)}</b>. Obrigado!`, MENU);
  } else if (d.acao === "defeito") {
    await db.from("ativos_ocorrencias").insert({
      ativo_id: ativo.id, tipo: "dano", data_ocorrencia: new Date().toISOString().slice(0, 10),
      descricao: `Defeito reportado via Telegram por ${d.colaborador_nome}`, criado_por: autor,
    });
    await aplicarMovimento(db, ativo,
      { status: "danificado" },
      { tipo: "ocorrencia", descricao: `Ocorrência (dano): defeito reportado via Telegram por ${d.colaborador_nome}`, status_novo: "danificado" },
      autor);
    await enviar(chatId, `✅ Registrado! <b>${escTg(nomeAtivo(ativo))}</b> foi marcado como <b>com defeito</b> (entra no resumo de conserto). Obrigado por avisar!`, MENU);
  }
  await salvarSessao(db, { ...sessao, estado: "pronto", dados: idBase });
}
