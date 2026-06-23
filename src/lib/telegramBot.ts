// ════════════════════════════════════════════════════════════════════════
// Bots INBOUND do Telegram — GUIADOS, máquina de estados em telegram_sessoes.
// DOIS bots, públicos separados:
//   • "ativo" = @cjr_ativo_bot (TELEGRAM_BOT_TOKEN) — pessoal de campo:
//        movimentação de equipamento (entrega/obra/estoque/defeito).
//   • "adm"   = @cjr_adm_bot   (TELEGRAM_BOT_TOKEN_ADM) — SÓ RH/Admin:
//        enviar documento (anexa na ficha) + alimentar a base (JunIA).
// Sessões separadas por bot via prefixo na chave (não colidem).
// ════════════════════════════════════════════════════════════════════════
import { supabaseAdmin } from "./supabase";
import { enviarTelegram, escTg } from "./telegram";
import { SLOTS_DOC, slotPorKey, detectarSlotPorTexto, detectarValidade, casarColaborador, ehDocEmpresa } from "./slotsDoc";
import { lerDocumentoGemini, geminiConfigurado, gerarTextoLLM, llmConfigurado, extrairJson, type HistMsg } from "./llm";
import { aplicarEntregaEpiDaFicha, type EpiAplicado } from "./epiLeitura";
import { registrarAcao } from "./auditoria";
import { responderJuniaIA } from "./juniaIA";
import { detectarCategoria } from "./junia";
import { assinarTreinoToken } from "./treinoStorage";

const SITE_TREINO = "https://www.costajr.com.br";

// Converte links /api/portal/treinamentos/abrir do texto da JunIA em BOTÕES que
// levam ao player COM MARCA D'ÁGUA (/treino/[token]). O token carrega o NOME de
// quem perguntou — o vídeo abre estampado com o nome (rastreável se encaminhado).
async function resolverTreinoTelegram(db: any, texto: string, nome: string): Promise<{ texto: string; botoes: { text: string; url: string }[] }> {
  const re = /https?:\/\/[^\s)]*\/api\/portal\/treinamentos\/abrir\?[^\s)]*/gi;
  const achados = Array.from(new Set(texto.match(re) || []));
  const botoes: { text: string; url: string }[] = [];
  let limpo = texto;
  for (const link of achados) {
    try {
      const u = new URL(link);
      const tipo = u.searchParams.get("tipo") === "pdf" ? "pdf" : "video";
      const id = u.searchParams.get("id") || "";
      if (id) {
        const token = await assinarTreinoToken({ vtipo: tipo, id, nome: nome || "Colaborador" });
        botoes.push({ text: tipo === "pdf" ? "📄 Abrir o procedimento" : "📺 Assistir ao treinamento", url: `${SITE_TREINO}/treino/${token}` });
      }
    } catch { /* ignore */ }
    limpo = limpo.split(link).join("");
  }
  // remove rótulos órfãos ("📺 Assista ao treinamento completo aqui:" / "📄 Veja ... aqui:")
  limpo = limpo.replace(/(?:📺|📄)\s*(?:Assista|Veja)[^\n:]*:\s*/g, "").replace(/\n{3,}/g, "\n\n").trim();
  return { texto: limpo, botoes };
}

function envVar(name: string): string {
  return (import.meta.env as any)[name] || (process.env as any)[name] || "";
}

// ── Identidade de cada bot ───────────────────────────────────────────────
type Modo = "ativo" | "adm" | "junia";
type Bot = { token: string; modo: Modo; pre: string; nome: string };
function botPorModo(modo: Modo): Bot {
  if (modo === "adm") {
    return { token: envVar("TELEGRAM_BOT_TOKEN_ADM") || envVar("TELEGRAM_BOT_TOKEN"), modo, pre: "adm:", nome: "@cjr_adm_bot" };
  }
  if (modo === "junia") {
    return { token: envVar("TELEGRAM_BOT_TOKEN_JUNIA") || envVar("TELEGRAM_BOT_TOKEN"), modo, pre: "junia:", nome: "@CjrJunIA_bot" };
  }
  return { token: envVar("TELEGRAM_BOT_TOKEN"), modo: "ativo", pre: "", nome: "@cjr_ativo_bot" };
}

// ── Telegram API helpers (best-effort) ──────────────────────────────────
async function tg(B: Bot, metodo: string, corpo: any): Promise<any> {
  if (!B.token) return { ok: false };
  try {
    const r = await fetch(`https://api.telegram.org/bot${B.token}/${metodo}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo),
    });
    return await r.json().catch(() => ({}));
  } catch { return { ok: false }; }
}
function enviar(B: Bot, chatId: number | string, texto: string, teclado?: any) {
  const corpo: any = { chat_id: chatId, text: texto, parse_mode: "HTML", disable_web_page_preview: true };
  if (teclado) corpo.reply_markup = teclado;
  return tg(B, "sendMessage", corpo);
}
function responderCallback(B: Bot, id: string, texto?: string) {
  return tg(B, "answerCallbackQuery", { callback_query_id: id, ...(texto ? { text: texto } : {}) });
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

// ── Sessão (telegram_sessoes) — chave prefixada por bot (não colide) ─────
type Sessao = { telegram_user_id: string; nome?: string; chat_id?: string; estado?: string; dados?: any };
async function getSessao(db: any, B: Bot, userId: string): Promise<Sessao | null> {
  const { data } = await db.from("telegram_sessoes").select("*").eq("telegram_user_id", B.pre + userId).maybeSingle();
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
const autorDe = (d: any) => `${d.colaborador_nome}${d.colaborador_email ? ` <${d.colaborador_email}>` : ""} (via Telegram)`;

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
  // notificação ao grupo de Ativos (canal padrão) — independente do bot que originou
  enviarTelegram(`${icone[String(movimento.tipo)] || "•"} <b>Ativo — movimentação (via Telegram)</b>\n${escTg(ident)}\n<i>${escTg(String(movimento.descricao || ""))}</i>${tgStatus}\nPor ${escTg(autor)}`).catch(() => {});
}

// ── Menus ────────────────────────────────────────────────────────────────
async function mostrarMenu(db: any, B: Bot, chatId: number, dados: any) {
  const nome = dados?.colaborador_nome || "colega";
  if (B.modo === "adm") {
    if (!(await ehRhAdmin(db, dados?.colaborador_id))) {
      await enviar(B, chatId,
        "Este bot é exclusivo do <b>RH/Admin</b> (documentos e base de conhecimento).\nPara movimentar equipamentos, use o <b>@cjr_ativo_bot</b>.");
      return;
    }
    await enviar(B, chatId, `Olá, <b>${escTg(nome)}</b>! 👋\nO que você quer fazer?`, inline([
      [{ text: "📄 Enviar documento", callback_data: "menu:doc" }],
      [{ text: "📚 Alimentar a base", callback_data: "menu:kb" }],
    ]));
    return;
  }
  // ativo
  await enviar(B, chatId, `Olá, <b>${escTg(nome)}</b>! 👋\nVocê quer registrar uma <b>movimentação de equipamento</b>?`,
    inline([[{ text: "✅ Sim", callback_data: "menu:mov" }, { text: "❌ Não", callback_data: "reg:nao" }]]));
}
function perguntarCategoria(B: Bot, chatId: number) {
  return enviar(B, chatId, "Qual é o <b>tipo</b> do equipamento?",
    inline([...CATEGORIAS.map((c) => [{ text: c.label, callback_data: "cat:" + c.key }]), btnCancelar]));
}
function perguntarDestino(B: Bot, chatId: number, equipNome: string, statusAtual: string, com?: string) {
  return enviar(B, chatId,
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
export async function processarUpdate(update: any, modo: Modo = "ativo"): Promise<void> {
  const db = supabaseAdmin();
  const B = botPorModo(modo);
  try {
    if (update?.callback_query) return await onCallback(db, B, update.callback_query);
    if (update?.message) return await onMessage(db, B, update.message);
  } catch { /* webhook sempre responde 200 */ }
}

// ── Mensagens ────────────────────────────────────────────────────────────
async function onMessage(db: any, B: Bot, msg: any) {
  const chat = msg.chat;
  if (!chat) return;
  if (chat.type !== "private") {
    // grupos: bot de RH (documentos+base) e bot da JunIA (base) atendem grupos registrados
    if (B.modo === "adm" || B.modo === "junia") return await onGrupoMensagem(db, B, msg);
    return;
  }
  if (B.modo === "junia") return await onMessageJunia(db, B, msg);
  const userId = String(msg.from?.id || "");
  const chatId = chat.id;
  if (!userId) return;

  if (msg.contact) {
    if (String(msg.contact.user_id || "") !== userId) { await enviar(B, chatId, "Compartilhe o <b>seu próprio</b> contato, por favor.", botaoTelefone); return; }
    return await identificar(db, B, userId, chatId, msg.contact.phone_number);
  }

  const texto = String(msg.text || "").trim();
  const sessao = await getSessao(db, B, userId);
  const identificado = sessao?.dados?.colaborador_id;

  if (/^\/cancelar/i.test(texto) && sessao) {
    await salvarSessao(db, { ...sessao, estado: "pronto", dados: idBaseDe(sessao.dados || {}) });
    if (identificado) await mostrarMenu(db, B, chatId, sessao!.dados);
    return;
  }

  if (!identificado) {
    const cab = B.modo === "adm"
      ? "👋 <b>Bot de RH — Costa Júnior</b>\n\nPor aqui você envia documentos e alimenta a base de conhecimento (só RH/Admin). Preciso te identificar pelo seu telefone cadastrado."
      : "👋 <b>Bot de Ativos — Costa Júnior</b>\n\nPara registrar movimentações de equipamento, preciso te identificar pelo seu telefone cadastrado.";
    await enviar(B, chatId, cab + "\n\nToque no botão abaixo:", botaoTelefone);
    return;
  }

  // DOCUMENTO (foto/PDF)
  if (msg.photo || msg.document) {
    if (B.modo !== "adm") { await enviar(B, chatId, "📄 Para enviar documentos, use o <b>bot de RH</b>: @cjr_adm_bot"); return; }
    if (!(await ehRhAdmin(db, identificado))) { await enviar(B, chatId, "📄 O envio de documentos é restrito ao RH/Admin."); return; }
    return await onDocumentoRecebido(db, B, sessao!, chatId, msg);
  }

  const estado = sessao?.estado || "pronto";
  if (estado === "busca_equip") return await buscarEquip(db, B, sessao!, chatId, texto);
  if (estado === "busca_pessoa") return await buscarPessoa(db, B, sessao!, chatId, texto);
  if (estado === "busca_obra") return await buscarObra(db, B, sessao!, chatId, texto);
  if (estado === "busca_pessoa_doc") return await buscarPessoaDoc(db, B, sessao!, chatId, texto);
  if (estado === "kb_aguarda") return await onTextoKb(db, B, sessao!, chatId, texto);
  if (estado === "kb_manual") return await onKbManual(db, B, sessao!, chatId, texto);
  if (estado === "doc_aguarda") { await enviar(B, chatId, "Me envie a <b>foto</b> ou o <b>PDF</b> do documento. 📎"); return; }

  // qualquer outra mensagem (estado pronto) → reabre o menu
  await mostrarMenu(db, B, chatId, sessao!.dados);
}

async function identificar(db: any, B: Bot, userId: string, chatId: number, telefone: string) {
  const { data: colabs } = await db.from("rh_colaboradores")
    .select("id, nome, email, telefone, telefone_pessoal, status").neq("status", "desligado").limit(3000);
  const achado = (colabs || []).find((c: any) => telBate(telefone, c.telefone) || telBate(telefone, c.telefone_pessoal));
  if (!achado) {
    await enviar(B, chatId, "❌ Não encontrei esse telefone no cadastro. Verifique com o RH se o seu telefone (com DDD) está na sua ficha. Depois toque em /start de novo.", tirarTeclado);
    return;
  }
  await salvarSessao(db, {
    telegram_user_id: B.pre + userId, nome: achado.nome, chat_id: String(chatId), estado: "pronto",
    dados: { colaborador_id: achado.id, colaborador_nome: achado.nome, colaborador_email: achado.email || null },
  });
  await enviar(B, chatId, `✅ Identificado: <b>${escTg(achado.nome)}</b>!`, tirarTeclado);
  if (B.modo === "junia") {
    await enviar(B, chatId, "Sou a <b>JunIA</b> 🤖, a inteligência da Costa Júnior. Pode me perguntar sobre <b>processos, normas e rotinas</b> — eu respondo aqui na hora. Se eu não souber, encaminho pro time e te aviso por aqui assim que responderem.");
    return;
  }
  await mostrarMenu(db, B, chatId, { colaborador_id: achado.id, colaborador_nome: achado.nome, colaborador_email: achado.email || null });
}

async function buscarEquip(db: any, B: Bot, sessao: Sessao, chatId: number, termo: string) {
  if (termo.length < 2) { await enviar(B, chatId, "Digite ao menos 2 letras do nome ou o número de patrimônio."); return; }
  const cat = sessao.dados?.categoria;
  const t = termo.replace(/[%,()]/g, " ").trim();
  let q = db.from("ativos").select("id, descricao, numero_patrimonial, status, alocado_para_nome")
    .or(`descricao.ilike.%${t}%,numero_patrimonial.ilike.%${t}%`)
    .not("status", "in", `(${STATUS_FORA.join(",")})`).limit(8);
  if (cat) q = q.eq("categoria", cat);
  const { data: ativos } = await q;
  if (!ativos?.length) {
    await enviar(B, chatId, `Não achei ${CAT_LABEL[cat] || "equipamento"} com "<b>${escTg(termo)}</b>". Tente outro nome/patrimônio, ou /cancelar.`);
    return;
  }
  const linhas = ativos.map((a: any) => [{ text: `${nomeAtivo(a)} — ${STATUS_LABEL[a.status] || a.status}`.slice(0, 60), callback_data: `eq:${a.id}` }]);
  linhas.push(btnCancelar);
  await enviar(B, chatId, "Selecione o equipamento:", inline(linhas));
}

async function buscarPessoa(db: any, B: Bot, sessao: Sessao, chatId: number, termo: string) {
  if (termo.length < 2) { await enviar(B, chatId, "Digite ao menos 2 letras do nome da pessoa."); return; }
  const t = termo.replace(/[%,()]/g, " ").trim();
  const { data: pessoas } = await db.from("rh_colaboradores").select("id, nome").neq("status", "desligado").ilike("nome", `%${t}%`).limit(8);
  if (!pessoas?.length) { await enviar(B, chatId, `Não achei ninguém com "<b>${escTg(termo)}</b>". Tente outro nome, ou /cancelar.`); return; }
  const linhas = pessoas.map((p: any) => [{ text: String(p.nome).slice(0, 60), callback_data: `pess:${p.id}` }]);
  linhas.push(btnCancelar);
  await enviar(B, chatId, "Para quem?", inline(linhas));
}

async function buscarObra(db: any, B: Bot, sessao: Sessao, chatId: number, termo: string) {
  if (termo.length < 2) { await enviar(B, chatId, "Digite ao menos 2 letras do nome da obra."); return; }
  const t = termo.replace(/[%,()]/g, " ").trim();
  const { data: obras } = await db.from("obras").select("id, nome").ilike("nome", `%${t}%`).limit(8);
  if (!obras?.length) { await enviar(B, chatId, `Não achei obra com "<b>${escTg(termo)}</b>". Tente outro nome, ou /cancelar.`); return; }
  const linhas = obras.map((o: any) => [{ text: String(o.nome).slice(0, 60), callback_data: `ob:${o.id}` }]);
  linhas.push(btnCancelar);
  await enviar(B, chatId, "Qual obra?", inline(linhas));
}

// ── Callbacks (botões) ───────────────────────────────────────────────────
async function onCallback(db: any, B: Bot, cq: any) {
  const userId = String(cq.from?.id || "");
  const chatId = cq.message?.chat?.id;
  const data = String(cq.data || "");
  await responderCallback(B, cq.id);
  if (!chatId) return;
  // botões do fluxo de GRUPO (token embutido; não dependem de sessão de usuário)
  if (/^(gkbsave|gkbcancel):/.test(data)) return await onCallbackKbGrupo(db, B, cq, chatId, data);
  if (/^(ganex|gtipo|gslot|gcancel|gemp|gempok):/.test(data)) return await onCallbackGrupo(db, B, cq, chatId, data);
  if (!userId) return;
  const sessao = await getSessao(db, B, userId);
  if (!sessao?.dados?.colaborador_id) { await enviar(B, chatId, "Sessão expirada. Toque em /start para recomeçar.", botaoTelefone); return; }
  const dados = sessao.dados || {};
  const idBase = idBaseDe(dados);

  if (data === "cancel" || data === "reg:nao") {
    await salvarSessao(db, { ...sessao, estado: "pronto", dados: idBase });
    await enviar(B, chatId, data === "reg:nao" ? "Ok! Quando precisar, é só mandar uma mensagem. 👋" : "Cancelado.");
    return;
  }
  if (data === "reg:sim" || data === "menu:mov") {
    await salvarSessao(db, { ...sessao, estado: "esc_categoria", dados: idBase });
    await perguntarCategoria(B, chatId);
    return;
  }
  if (data === "menu:doc" || data === "menu:kb") {
    if (!(await ehRhAdmin(db, dados.colaborador_id))) { await enviar(B, chatId, "Recurso restrito ao RH/Admin."); return; }
    if (data === "menu:doc") {
      await salvarSessao(db, { ...sessao, estado: "doc_aguarda", dados: idBase });
      await enviar(B, chatId, "📄 <b>Enviar documento</b>\nMe mande a <b>foto</b> ou o <b>PDF</b> do documento (de um colaborador). Eu leio e sugiro de quem é, o tipo e a validade.");
    } else {
      await salvarSessao(db, { ...sessao, estado: "kb_aguarda", dados: idBase });
      await enviar(B, chatId, "📚 <b>Alimentar a base</b>\nMe mande o <b>texto/assunto</b> a cadastrar (ex.: \"o vencimento do cartão X é dia Y\"). Eu transformo em pergunta e resposta pra você confirmar.");
    }
    return;
  }
  if (data === "danex") return await anexarDoc(db, B, sessao, chatId);
  if (data === "dpess") {
    await salvarSessao(db, { ...sessao, estado: "busca_pessoa_doc", dados });
    await enviar(B, chatId, "🔎 Digite o <b>nome da pessoa</b> dona do documento:");
    return;
  }
  if (data === "dtipo") {
    const linhas = SLOTS_DOC.map((s) => [{ text: s.label.slice(0, 60), callback_data: "dslot:" + s.key }]);
    linhas.push(btnCancelar);
    await enviar(B, chatId, "Qual o <b>tipo</b> do documento?", inline(linhas));
    return;
  }
  if (data.startsWith("dslot:")) {
    const slot = slotPorKey(data.slice(6)) || slotPorKey("outro")!;
    const nd = { ...dados, sug_slot: slot.key, sug_slot_label: slot.label, sug_tem_validade: slot.validade };
    await salvarSessao(db, { ...sessao, estado: "doc_confirma", dados: nd });
    await cardDoc(B, chatId, nd);
    return;
  }
  if (data.startsWith("pdoc:")) {
    const { data: p } = await db.from("rh_colaboradores").select("id, nome").eq("id", data.slice(5)).maybeSingle();
    if (!p) { await enviar(B, chatId, "Pessoa não encontrada."); return; }
    const nd = { ...dados, sug_colab_id: p.id, sug_colab_nome: p.nome };
    await salvarSessao(db, { ...sessao, estado: "doc_confirma", dados: nd });
    await cardDoc(B, chatId, nd);
    return;
  }
  if (data === "kbsave") return await salvarKb(db, B, sessao, chatId);
  if (data.startsWith("cat:")) {
    const cat = data.slice(4);
    await salvarSessao(db, { ...sessao, estado: "busca_equip", dados: { ...idBase, categoria: cat } });
    await enviar(B, chatId, `🔎 Digite o <b>nome</b> ou o <b>patrimônio</b> do equipamento (${CAT_LABEL[cat] || ""}) que você movimentou:`);
    return;
  }
  if (data.startsWith("eq:")) {
    const { data: ativo } = await db.from("ativos").select("id, descricao, numero_patrimonial, status, alocado_para_tipo, alocado_para_id, alocado_para_nome").eq("id", data.slice(3)).maybeSingle();
    if (!ativo) { await enviar(B, chatId, "Equipamento não encontrado. /cancelar e tente de novo."); return; }
    await salvarSessao(db, { ...sessao, estado: "esc_destino", dados: { ...dados, equip_id: ativo.id, equip_nome: nomeAtivo(ativo) } });
    await perguntarDestino(B, chatId, nomeAtivo(ativo), ativo.status, ativo.alocado_para_nome);
    return;
  }
  if (data === "dest:estoque" || data === "dest:defeito") {
    const acao = data === "dest:estoque" ? "devolver" : "defeito";
    await salvarSessao(db, { ...sessao, estado: "mov_confirma", dados: { ...dados, acao } });
    const txt = acao === "devolver"
      ? `Confirma: <b>${escTg(dados.equip_nome)}</b> foi <b>devolvido ao estoque</b>?`
      : `Confirma: <b>${escTg(dados.equip_nome)}</b> está <b>com defeito</b> (vai para conserto)?`;
    await enviar(B, chatId, txt, inline([[{ text: "✅ Confirmar", callback_data: "ok" }], btnCancelar]));
    return;
  }
  if (data === "dest:pessoa") {
    await salvarSessao(db, { ...sessao, estado: "busca_pessoa", dados: { ...dados, acao: "entregar" } });
    await enviar(B, chatId, "🔎 Digite o <b>nome da pessoa</b> para quem você entregou:");
    return;
  }
  if (data === "dest:obra") {
    await salvarSessao(db, { ...sessao, estado: "busca_obra", dados: { ...dados, acao: "obra" } });
    await enviar(B, chatId, "🔎 Digite o <b>nome da obra</b> para onde você levou:");
    return;
  }
  if (data.startsWith("pess:")) {
    const { data: p } = await db.from("rh_colaboradores").select("id, nome").eq("id", data.slice(5)).maybeSingle();
    if (!p) { await enviar(B, chatId, "Pessoa não encontrada. /cancelar e tente de novo."); return; }
    await salvarSessao(db, { ...sessao, estado: "mov_confirma", dados: { ...dados, acao: "entregar", destino_id: p.id, destino_nome: p.nome } });
    await enviar(B, chatId, `Confirma: <b>${escTg(dados.equip_nome)}</b> foi <b>entregue para ${escTg(p.nome)}</b>?`, inline([[{ text: "✅ Confirmar", callback_data: "ok" }], btnCancelar]));
    return;
  }
  if (data.startsWith("ob:")) {
    const { data: o } = await db.from("obras").select("id, nome").eq("id", data.slice(3)).maybeSingle();
    if (!o) { await enviar(B, chatId, "Obra não encontrada. /cancelar e tente de novo."); return; }
    await salvarSessao(db, { ...sessao, estado: "mov_confirma", dados: { ...dados, acao: "obra", destino_id: o.id, destino_nome: o.nome } });
    await enviar(B, chatId, `Confirma: <b>${escTg(dados.equip_nome)}</b> foi levado para a obra <b>${escTg(o.nome)}</b>?`, inline([[{ text: "✅ Confirmar", callback_data: "ok" }], btnCancelar]));
    return;
  }
  if (data === "ok") return await confirmar(db, B, sessao, chatId);
}

async function confirmar(db: any, B: Bot, sessao: Sessao, chatId: number) {
  const d = sessao.dados || {};
  if (!d.equip_id || !d.acao) { await enviar(B, chatId, "Faltou informação. Recomece mandando uma mensagem."); return; }
  const { data: ativo } = await db.from("ativos").select("*").eq("id", d.equip_id).maybeSingle();
  if (!ativo) { await enviar(B, chatId, "Equipamento não encontrado."); return; }
  const autor = autorDe(d);

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

  await enviar(B, chatId, `✅ <b>Equipamento movimentado com sucesso!</b>\n${escTg(nomeAtivo(ativo))} foi atualizado na base. Obrigado! 🙌`,
    inline([[{ text: "📦 Registrar outra", callback_data: "menu:mov" }]]));
  await salvarSessao(db, { ...sessao, estado: "pronto", dados: idBaseDe(d) });
}

// ════════════════════════════════════════════════════════════════════════
// DOCUMENTOS + BASE (bot adm). Reaproveita o "cérebro" da Caixa de Entrada.
// ════════════════════════════════════════════════════════════════════════

// Baixa o conteúdo de um arquivo do Telegram (getFile → download).
async function baixarArquivoTg(B: Bot, fileId: string): Promise<Buffer | null> {
  if (!B.token) return null;
  try {
    const f = await tg(B, "getFile", { file_id: fileId });
    const path = f?.result?.file_path;
    if (!path) return null;
    const r = await fetch(`https://api.telegram.org/file/bot${B.token}/${path}`);
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch { return null; }
}

// Lê o TEXTO de dentro do documento (camada de texto do PDF, via unpdf — sem LLM)
// para detectar tipo/validade/colaborador quando o NOME do arquivo não ajuda
// (ex.: arquivo enviado sem nome, "documento.pdf", "foto-telegram.jpg").
async function extrairTextoConteudo(buf: Buffer, ctL: string, nome: string): Promise<string> {
  try {
    if (ctL === "application/pdf" || /\.pdf$/i.test(nome)) {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const { text } = await extractText(pdf, { mergePages: true });
      return String(text || "").replace(/\s+/g, " ").trim().slice(0, 8000);
    }
  } catch { /* PDF escaneado/sem camada de texto → cai no Gemini se houver */ }
  return "";
}

async function onDocumentoRecebido(db: any, B: Bot, sessao: Sessao, chatId: number, msg: any) {
  await enviar(B, chatId, "📎 Recebi! Analisando o documento… ⏳");
  let fileId = "", nome = "documento", ct = "application/octet-stream";
  if (msg.document) { fileId = msg.document.file_id; nome = msg.document.file_name || "documento"; ct = msg.document.mime_type || "application/octet-stream"; }
  else if (msg.photo?.length) { fileId = msg.photo[msg.photo.length - 1].file_id; nome = "foto-telegram.jpg"; ct = "image/jpeg"; }
  if (!fileId) { await enviar(B, chatId, "Não consegui ler esse arquivo. Envie como foto ou PDF."); return; }

  const ctL = ct.toLowerCase();
  const tipoOk = ctL === "application/pdf" || ctL.startsWith("image/") || ctL.includes("word") || ctL.includes("officedocument") || /\.(pdf|jpg|jpeg|png|webp|doc|docx)$/i.test(nome);
  if (!tipoOk) { await enviar(B, chatId, "❌ Formato não aceito — envie PDF, foto ou Word."); return; }

  const buf = await baixarArquivoTg(B, fileId);
  if (!buf) { await enviar(B, chatId, "❌ Não consegui baixar o arquivo. Tente enviar de novo."); return; }
  if (buf.length > 18 * 1024 * 1024) { await enviar(B, chatId, "❌ Arquivo muito grande (máx. ~18 MB)."); return; }

  let ext = (nome.includes(".") ? nome.split(".").pop() : "")?.toLowerCase().replace(/[^a-z0-9]/g, "") || "";
  if (!ext || ext.length > 5) ext = ctL.includes("pdf") ? "pdf" : ctL.startsWith("image/") ? "jpg" : "bin";
  const storagePath = `inbox/tg-${Date.now()}.${ext}`;
  const { error: errUp } = await db.storage.from("rh").upload(storagePath, buf, { contentType: ct, upsert: false });
  if (errUp) { await enviar(B, chatId, "❌ Falha ao guardar o arquivo: " + escTg(errUp.message)); return; }

  const { data: colabs } = await db.from("rh_colaboradores").select("id, nome").neq("status", "desligado").limit(3000);
  const lista = (colabs || []).map((c: any) => ({ id: c.id, nome: c.nome }));
  let slotKey = detectarSlotPorTexto(nome);
  let validade = detectarValidade(nome);
  let match = casarColaborador(nome, lista);
  // Nome do arquivo nem sempre vem — lê a LEGENDA + o TEXTO do documento (PDF) e
  // completa o que faltou (tipo, validade e a quem pertence).
  const textoExtra = [(msg.caption || "").trim(), await extrairTextoConteudo(buf, ctL, nome)].filter(Boolean).join("  ");
  if (textoExtra) {
    if (!slotKey) slotKey = detectarSlotPorTexto(textoExtra);
    if (!validade) validade = detectarValidade(textoExtra);
    if (!match) match = casarColaborador(textoExtra, lista);
  }
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
  // Documento contábil/da empresa (balancete, DRE…) traz o nome do sócio no corpo →
  // não sugere PESSOA; cai no fluxo "é da empresa".
  if (ehDocEmpresa(`${nome} ${textoExtra}`)) match = null;
  const slot = (slotKey && slotPorKey(slotKey)) || slotPorKey("outro")!;
  const nd = {
    ...idBaseDe(sessao.dados || {}), doc_path: storagePath, doc_nome: nome,
    sug_colab_id: match?.id || null, sug_colab_nome: match?.nome || null,
    sug_slot: slot.key, sug_slot_label: slot.label, sug_tem_validade: slot.validade,
    sug_validade: validade || null, ia,
  };
  await salvarSessao(db, { ...sessao, estado: "doc_confirma", dados: nd });
  await cardDoc(B, chatId, nd);
}

async function cardDoc(B: Bot, chatId: number, d: any) {
  const pessoa = d.sug_colab_nome ? `<b>${escTg(d.sug_colab_nome)}</b>` : "<i>(não identifiquei a pessoa)</i>";
  const venc = d.sug_tem_validade ? `\nValidade: ${d.sug_validade ? escTg(d.sug_validade) : "<i>não detectei</i>"}` : "";
  const origem = d.ia ? "🔮 li o documento" : "📄 sugestão automática";
  const linhas: { text: string; callback_data: string }[][] = [];
  if (d.sug_colab_id) linhas.push([{ text: "✅ Anexar na ficha", callback_data: "danex" }]);
  linhas.push([{ text: "👤 Trocar pessoa", callback_data: "dpess" }, { text: "🏷️ Trocar tipo", callback_data: "dtipo" }]);
  linhas.push(btnCancelar);
  await enviar(B, chatId,
    `📎 <b>${escTg(d.doc_nome)}</b> (${origem})\n\nPessoa: ${pessoa}\nTipo: <b>${escTg(d.sug_slot_label)}</b>${venc}\n\n${d.sug_colab_id ? "Confirma?" : "Toque em <b>Trocar pessoa</b> pra escolher de quem é."}`,
    inline(linhas));
}

async function buscarPessoaDoc(db: any, B: Bot, sessao: Sessao, chatId: number, termo: string) {
  if (termo.length < 2) { await enviar(B, chatId, "Digite ao menos 2 letras do nome."); return; }
  const t = termo.replace(/[%,()]/g, " ").trim();
  const { data: pessoas } = await db.from("rh_colaboradores").select("id, nome").neq("status", "desligado").ilike("nome", `%${t}%`).limit(8);
  if (!pessoas?.length) { await enviar(B, chatId, `Não achei ninguém com "<b>${escTg(termo)}</b>". Tente outro nome, ou /cancelar.`); return; }
  const linhas = pessoas.map((p: any) => [{ text: String(p.nome).slice(0, 60), callback_data: "pdoc:" + p.id }]);
  linhas.push(btnCancelar);
  await enviar(B, chatId, "De quem é o documento?", inline(linhas));
}

// Após anexar uma Ficha de EPI, baixa o arquivo, lê os itens (EPI + CA) e atualiza
// os EPIs do colaborador. Retorna um trecho de mensagem (vazio se nada foi lido).
async function epiDaFichaAnexada(db: any, colaboradorId: string, docPath: string, docNome: string): Promise<string> {
  try {
    const dl = await db.storage.from("rh").download(docPath);
    const blob = dl?.data;
    if (!blob) return "";
    const buf = Buffer.from(await blob.arrayBuffer());
    const ct = /\.pdf$/i.test(docNome || docPath) ? "application/pdf" : "image/jpeg";
    const aplicados: EpiAplicado[] = await aplicarEntregaEpiDaFicha(db, colaboradorId, buf, ct, docNome || "ficha.pdf");
    if (!aplicados.length) return "";
    const fmtD = (v: string) => v.split("-").reverse().join("/");
    const linhas = aplicados.map((a) => {
      let l = `• ${escTg(a.epi)} — CA ${escTg(a.ca)}${a.validade ? ` (vence ${escTg(fmtD(a.validade))})` : " <i>(defina o vencimento)</i>"}`;
      if (a.antesCA) l += `\n   ⚠️ <b>confira o CA</b> — antes era ${escTg(a.antesCA)}${a.antesValidade ? ` (vencia ${escTg(fmtD(a.antesValidade))})` : ""}`;
      return l;
    }).join("\n");
    return `\n\n🦺 <b>Atualizei ${aplicados.length} EPI(s)</b> na ficha do colaborador:\n${linhas}`;
  } catch { return ""; }
}

async function anexarDoc(db: any, B: Bot, sessao: Sessao, chatId: number) {
  const d = sessao.dados || {};
  if (!d.doc_path || !d.sug_colab_id) { await enviar(B, chatId, "Faltou a pessoa. Toque em 👤 Trocar pessoa."); return; }
  const slot = slotPorKey(d.sug_slot) || slotPorKey("outro")!;
  const validade = d.sug_tem_validade ? (d.sug_validade || null) : null;
  const titulo = `${slot.prefixo} — ${d.doc_nome}`.slice(0, 200);
  const autor = autorDe(d);
  const { data: row, error } = await db.from("rh_documentos").insert({
    colaborador_id: d.sug_colab_id, titulo, tipo: slot.tipo, storage_path: d.doc_path,
    validade, validade_na: !d.sug_tem_validade, criado_por: autor,
  }).select().single();
  if (error) { await enviar(B, chatId, "❌ Não consegui anexar: " + escTg(error.message)); return; }
  await registrarAcao(db, { req: undefined as any, admin: { email: autor } as any }, {
    acao: "criar", entidade: "rh_documentos", registro_id: row?.id ?? null,
    descricao: `Telegram: anexou "${slot.label}" a ${d.sug_colab_nome}`, dados: { tipo: slot.tipo, validade },
  });
  const epiMsg = slot.tipo === "ficha_epi" && d.sug_colab_id ? await epiDaFichaAnexada(db, d.sug_colab_id, d.doc_path, d.doc_nome) : "";
  await enviar(B, chatId, `✅ <b>Anexado!</b>\n${escTg(slot.label)} → ficha de <b>${escTg(d.sug_colab_nome)}</b>. 🙌${epiMsg}`,
    inline([[{ text: "📄 Enviar outro", callback_data: "menu:doc" }]]));
  await salvarSessao(db, { ...sessao, estado: "pronto", dados: idBaseDe(d) });
}

async function onTextoKb(db: any, B: Bot, sessao: Sessao, chatId: number, texto: string) {
  if (texto.length < 5) { await enviar(B, chatId, "Mande um texto um pouco maior pra eu entender o assunto. 🙂"); return; }
  let pergunta = "", resposta = "", categoria = "Geral";
  if (llmConfigurado()) {
    await enviar(B, chatId, "✨ Organizando… ⏳");
    try {
      const system = `Você organiza conhecimento interno da Costa Júnior Engenharia para um FAQ (a JunIA usa). A partir de um texto livre, gere UMA pergunta clara (como um colaborador perguntaria) e a resposta, em português, objetivo. Não invente além do texto. Responda APENAS JSON: {"pergunta":"...","resposta":"...","categoria":"Geral|Operacional|RH|Financeiro|Comercial|Administrativo"}`;
      const raw = await gerarTextoLLM(system, [{ role: "user", content: texto.slice(0, 4000) }]);
      const o = raw ? extrairJson(raw) : null;
      if (o && o.resposta) { pergunta = String(o.pergunta || "").trim(); resposta = String(o.resposta || "").trim(); categoria = String(o.categoria || "Geral").trim() || "Geral"; }
    } catch { /* cai no manual */ }
  }
  if (!resposta) {
    await salvarSessao(db, { ...sessao, estado: "kb_manual", dados: idBaseDe(sessao.dados || {}) });
    await enviar(B, chatId, "Não consegui organizar com a IA agora. Me mande no formato:\n<b>Pergunta | Resposta</b>\n(ex.: Qual o prazo do Santander? | 5 dias úteis)");
    return;
  }
  const nd = { ...idBaseDe(sessao.dados || {}), kb_pergunta: pergunta, kb_resposta: resposta, kb_categoria: categoria };
  await salvarSessao(db, { ...sessao, estado: "kb_confirma", dados: nd });
  await enviar(B, chatId,
    `📚 Vou cadastrar na base:\n\n<b>P:</b> ${escTg(pergunta)}\n<b>R:</b> ${escTg(resposta)}\n<b>Categoria:</b> ${escTg(categoria)}`,
    inline([[{ text: "✅ Salvar", callback_data: "kbsave" }], [{ text: "✏️ Reescrever (mande de novo)", callback_data: "menu:kb" }], btnCancelar]));
}

async function onKbManual(db: any, B: Bot, sessao: Sessao, chatId: number, texto: string) {
  const i = texto.indexOf("|");
  if (i < 1) { await enviar(B, chatId, "Use o formato <b>Pergunta | Resposta</b>."); return; }
  const pergunta = texto.slice(0, i).trim(), resposta = texto.slice(i + 1).trim();
  if (!pergunta || !resposta) { await enviar(B, chatId, "Faltou a pergunta ou a resposta."); return; }
  const nd = { ...idBaseDe(sessao.dados || {}), kb_pergunta: pergunta, kb_resposta: resposta, kb_categoria: "Geral" };
  await salvarSessao(db, { ...sessao, estado: "kb_confirma", dados: nd });
  await enviar(B, chatId, `📚 Vou cadastrar:\n<b>P:</b> ${escTg(pergunta)}\n<b>R:</b> ${escTg(resposta)}`, inline([[{ text: "✅ Salvar", callback_data: "kbsave" }], btnCancelar]));
}

async function salvarKb(db: any, B: Bot, sessao: Sessao, chatId: number) {
  const d = sessao.dados || {};
  if (!d.kb_pergunta || !d.kb_resposta) { await enviar(B, chatId, "Faltou conteúdo. Recomece em 📚 Alimentar a base."); return; }
  const autor = autorDe(d);
  const { data: row, error } = await db.from("portal_kb").insert({ question: d.kb_pergunta, answer: d.kb_resposta, category: d.kb_categoria || "Geral" }).select().single();
  if (error) { await enviar(B, chatId, "❌ Não consegui salvar: " + escTg(error.message)); return; }
  await registrarAcao(db, { req: undefined as any, admin: { email: autor } as any }, {
    acao: "criar", entidade: "portal_kb", registro_id: row?.id ?? null,
    descricao: `Telegram: adicionou à base "${String(d.kb_pergunta).slice(0, 80)}"`, dados: { category: d.kb_categoria },
  });
  await enviar(B, chatId, "✅ <b>Salvo na base!</b> Já vale na JunIA. 🤖", inline([[{ text: "📚 Cadastrar outro", callback_data: "menu:kb" }]]));
  await salvarSessao(db, { ...sessao, estado: "pronto", dados: idBaseDe(d) });
}

// ════════════════════════════════════════════════════════════════════════
// GRUPO de RH = inbox de DOCUMENTOS (só o bot adm, só no grupo registrado).
// Quem está no grupo já é autorizado (RH/Admin) — a "porta" é o próprio grupo.
// Requer: bot adicionado ao grupo + Privacidade do bot DESLIGADA (BotFather),
// e um admin do grupo enviar /ativar_grupo uma vez.
// ════════════════════════════════════════════════════════════════════════
const SYS_LER_DOC = `Você lê um documento de RH de um colaborador da construtora Costa Júnior e extrai metadados. Responda APENAS JSON: {"nome_pessoa":"nome completo ou vazio","tipo":"um de: ASO, CNH, RG, Contrato, CTPS, Titulo de Eleitor, Certidao, Comprovante de Residencia, NR-35, NR-10, NR-06, NR-01, Advertencia, Suspensao, Ordem de Servico, Outro","validade":"AAAA-MM-DD ou vazio"}`;

async function getGrupoRh(db: any): Promise<string | null> {
  const { data } = await db.from("telegram_sessoes").select("dados").eq("telegram_user_id", "grupo_rh").maybeSingle();
  return data?.dados?.chat_id != null ? String(data.dados.chat_id) : null;
}
async function getGrupoBase(db: any): Promise<string | null> {
  const { data } = await db.from("telegram_sessoes").select("dados").eq("telegram_user_id", "grupo_base").maybeSingle();
  return data?.dados?.chat_id != null ? String(data.dados.chat_id) : null;
}
async function getGrupoBaseInfo(db: any): Promise<any | null> {
  const { data } = await db.from("telegram_sessoes").select("dados").eq("telegram_user_id", "grupo_base").maybeSingle();
  return data?.dados || null;
}

// Compara o novo item com a base existente (IA): "novo" | "duplicado" | "contradiz".
async function checarBaseKb(db: any, pergunta: string, resposta: string): Promise<any | null> {
  if (!llmConfigurado()) return null;
  try {
    const { data: kb } = await db.from("portal_kb").select("question, answer").limit(500);
    if (!kb?.length) return null;
    const base = kb.slice(0, 150).map((k: any) => `- P: ${k.question}\n  R: ${k.answer}`).join("\n");
    const system = `Você compara um NOVO item de FAQ interno com a base já existente. Classifique o NOVO como: "novo" (não há nada equivalente), "duplicado" (já existe item que responde à MESMA coisa) ou "contradiz" (existe item cuja resposta é INCOMPATÍVEL com a do novo). Responda APENAS JSON: {"status":"novo|duplicado|contradiz","item":"a pergunta existente conflitante ou vazio","resposta_existente":"a resposta existente conflitante ou vazio","motivo":"curto"}`;
    const raw = await gerarTextoLLM(system, [{ role: "user", content: `NOVO:\nP: ${pergunta}\nR: ${resposta}\n\nBASE EXISTENTE:\n${base}` }]);
    const o = raw ? extrairJson(raw) : null;
    if (o && o.status) return { status: String(o.status).toLowerCase(), item: String(o.item || ""), resposta_existente: String(o.resposta_existente || ""), motivo: String(o.motivo || "") };
  } catch { /* sem checagem → segue */ }
  return null;
}
async function ehAdminGrupo(B: Bot, chatId: number, userId?: number): Promise<boolean> {
  if (!userId) return false;
  const r = await tg(B, "getChatMember", { chat_id: chatId, user_id: userId });
  const st = r?.result?.status;
  return st === "creator" || st === "administrator";
}
function nomeRemetente(from: any): string {
  const nome = `${from?.first_name || ""} ${from?.last_name || ""}`.trim() || "alguém";
  return from?.username ? `${nome} (@${from.username})` : nome;
}

async function onGrupoMensagem(db: any, B: Bot, msg: any) {
  const chat = msg.chat;
  const chatId = chat.id;
  const texto = String(msg.text || "").trim();

  // ── ativar grupo de DOCUMENTOS (só pelo bot de RH) ──
  if (/^\/ativar_grupo(@\w+)?/i.test(texto)) {
    if (B.modo !== "adm") {
      await enviar(B, chatId, "Aqui no grupo eu cuido da <b>base de conhecimento</b> 🧠. Para isso, mande <code>/ativar_base</code>. (Grupo de DOCUMENTOS é com o bot de RH @cjr_adm_bot.)");
      return;
    }
    if (!(await ehAdminGrupo(B, chatId, msg.from?.id))) {
      await enviar(B, chatId, "Só um <b>administrador do grupo</b> pode ativar este grupo.");
      return;
    }
    await salvarSessao(db, { telegram_user_id: "grupo_rh", chat_id: String(chatId), estado: "ativo", dados: { chat_id: chatId, titulo: chat.title || "" } });
    await enviar(B, chatId, "✅ <b>Grupo ativado como inbox de DOCUMENTOS!</b>\nMandem aqui a <b>foto</b> ou o <b>PDF</b> de um documento. Eu leio e pergunto o destino:\n• <b>Pessoa (RH)</b> → arquiva na ficha do colaborador\n• <b>Empresa (Jurídico)</b> → anexa no contrato/fornecedor (Documentos da Empresa)\n\n⚠️ Lembrem: <b>todos deste grupo veem os documentos</b> — mantenham só RH/Admin aqui.");
    return;
  }
  // ── ativar grupo da BASE DE CONHECIMENTO ──
  if (/^\/ativar_base(@\w+)?/i.test(texto)) {
    if (!(await ehAdminGrupo(B, chatId, msg.from?.id))) {
      await enviar(B, chatId, "Só um <b>administrador do grupo</b> pode ativar este grupo.");
      return;
    }
    await salvarSessao(db, { telegram_user_id: "grupo_base", chat_id: String(chatId), estado: "ativo", dados: { chat_id: chatId, titulo: chat.title || "", bot_modo: B.modo, aprovador_id: msg.from?.id || null, aprovador_nome: nomeRemetente(msg.from) } });
    await enviar(B, chatId, `✅ <b>Grupo ativado como BASE DE CONHECIMENTO da JunIA!</b>\nMandem aqui as <b>instruções/textos</b> que querem cadastrar. Eu organizo em <b>pergunta + resposta</b>, <b>checo se já existe ou se contradiz</b> a base, e mostro pra aprovação.\n\n🔒 <b>Só ${escTg(nomeRemetente(msg.from))}</b> (quem ativou) pode <b>aprovar e salvar</b> na base. As demais pessoas enviam, mas a publicação depende dessa aprovação.`);
    return;
  }

  const rh = await getGrupoRh(db);
  const base = await getGrupoBase(db);
  const cid = String(chatId);

  // grupo de DOCUMENTOS
  if (rh && cid === rh) {
    if (msg.photo || msg.document) return await onDocGrupo(db, B, msg, chatId);
    return; // texto no grupo de documentos → ignora
  }
  // grupo da BASE DE CONHECIMENTO
  if (base && cid === base) {
    // resposta (reply) a uma pergunta encaminhada pela JunIA → manda pro autor
    const rep = msg.reply_to_message;
    if (rep?.message_id && texto) {
      const { data: pq } = await db.from("telegram_sessoes").select("dados").eq("telegram_user_id", "pq:" + rep.message_id).maybeSingle();
      if (pq?.dados) return await responderPerguntaEncaminhada(db, B, msg, chatId, rep.message_id, pq.dados, texto);
    }
    if (msg.photo || msg.document) { await enviar(B, chatId, "📚 Este grupo é da <b>base de conhecimento</b> (texto). Para enviar documentos, use o grupo de documentos."); return; }
    if (texto && texto.length >= 15 && !texto.startsWith("/")) return await onTextoKbGrupo(db, B, msg, chatId, texto);
    return;
  }
  // grupo não registrado: só orienta se mandaram doc ou comando de ativacao
  if (msg.photo || msg.document || /^\/ativar/i.test(texto)) {
    await enviar(B, chatId, "Este grupo ainda não está ativado. Um <b>administrador</b> deve enviar <code>/ativar_grupo</code> (documentos) ou <code>/ativar_base</code> (base de conhecimento).");
  }
}

async function onDocGrupo(db: any, B: Bot, msg: any, chatId: number) {
  let fileId = "", nome = "documento", ct = "application/octet-stream";
  if (msg.document) { fileId = msg.document.file_id; nome = msg.document.file_name || "documento"; ct = msg.document.mime_type || "application/octet-stream"; }
  else if (msg.photo?.length) { fileId = msg.photo[msg.photo.length - 1].file_id; nome = "foto-telegram.jpg"; ct = "image/jpeg"; }
  if (!fileId) return;
  const ctL = ct.toLowerCase();
  const tipoOk = ctL === "application/pdf" || ctL.startsWith("image/") || ctL.includes("word") || ctL.includes("officedocument") || /\.(pdf|jpg|jpeg|png|webp|doc|docx)$/i.test(nome);
  if (!tipoOk) { await enviar(B, chatId, "❌ Formato não aceito — envie PDF, foto ou Word."); return; }
  await enviar(B, chatId, "📎 Analisando o documento… ⏳");
  const buf = await baixarArquivoTg(B, fileId);
  if (!buf) { await enviar(B, chatId, "❌ Não consegui baixar o arquivo. Tente de novo."); return; }
  if (buf.length > 18 * 1024 * 1024) { await enviar(B, chatId, "❌ Arquivo muito grande (máx. ~18 MB)."); return; }
  let ext = (nome.includes(".") ? nome.split(".").pop() : "")?.toLowerCase().replace(/[^a-z0-9]/g, "") || "";
  if (!ext || ext.length > 5) ext = ctL.includes("pdf") ? "pdf" : ctL.startsWith("image/") ? "jpg" : "bin";
  const storagePath = `inbox/tg-${Date.now()}.${ext}`;
  const { error: errUp } = await db.storage.from("rh").upload(storagePath, buf, { contentType: ct, upsert: false });
  if (errUp) { await enviar(B, chatId, "❌ Falha ao guardar: " + escTg(errUp.message)); return; }

  const { data: colabs } = await db.from("rh_colaboradores").select("id, nome").neq("status", "desligado").limit(3000);
  const lista = (colabs || []).map((c: any) => ({ id: c.id, nome: c.nome }));
  let slotKey = detectarSlotPorTexto(nome);
  let validade = detectarValidade(nome);
  let match = casarColaborador(nome, lista);
  // Nome do arquivo nem sempre vem — lê a LEGENDA + o TEXTO do documento (PDF).
  const textoExtra = [(msg.caption || "").trim(), await extrairTextoConteudo(buf, ctL, nome)].filter(Boolean).join("  ");
  if (textoExtra) {
    if (!slotKey) slotKey = detectarSlotPorTexto(textoExtra);
    if (!validade) validade = detectarValidade(textoExtra);
    if (!match) match = casarColaborador(textoExtra, lista);
  }
  let ia = false, iaNome = "";
  if (geminiConfigurado() && (ctL === "application/pdf" || ctL.startsWith("image/"))) {
    try {
      const raw = await lerDocumentoGemini(SYS_LER_DOC, "Extraia os metadados deste documento.", buf.toString("base64"), ct);
      const o = raw ? extrairJson(raw) : null;
      if (o) {
        ia = true;
        const si = detectarSlotPorTexto(String(o.tipo || "")); if (si) slotKey = si;
        if (o.validade && /^\d{4}-\d{2}-\d{2}$/.test(String(o.validade).trim())) validade = String(o.validade).trim();
        if (o.nome_pessoa) { iaNome = String(o.nome_pessoa); const m2 = casarColaborador(iaNome, lista); if (m2 && (!match || m2.score >= match.score)) match = m2; }
      }
    } catch { /* segue pela heurística do nome */ }
  }
  // Documento contábil/da empresa (balancete, DRE…) → não sugere PESSOA.
  if (ehDocEmpresa(`${nome} ${textoExtra}`)) match = null;
  const slot = (slotKey && slotPorKey(slotKey)) || slotPorKey("outro")!;
  const token = Date.now().toString(36);
  const dados = {
    doc_path: storagePath, doc_nome: nome, ct, ia_nome: iaNome, autor: `${nomeRemetente(msg.from)} (via grupo Telegram)`,
    sug_colab_id: match?.id || null, sug_colab_nome: match?.nome || null,
    sug_slot: slot.key, sug_slot_label: slot.label, sug_tem_validade: slot.validade, sug_validade: validade || null, ia,
  };
  await salvarSessao(db, { telegram_user_id: "gdoc:" + token, chat_id: String(chatId), estado: "pendente", dados });
  await cardDocGrupo(B, chatId, token, dados);
}

async function cardDocGrupo(B: Bot, chatId: number, token: string, d: any) {
  const venc = d.sug_tem_validade ? `\nValidade: ${d.sug_validade ? escTg(d.sug_validade) : "<i>não detectei</i>"}` : "";
  const origem = d.ia ? "🔮 li o documento" : "📄 sugestão automática";
  if (d.sug_colab_id) {
    const primeiro = String(d.sug_colab_nome || "").split(" ")[0];
    await enviar(B, chatId,
      `📎 <b>${escTg(d.doc_nome)}</b> (${origem})\nPessoa (RH): <b>${escTg(d.sug_colab_nome)}</b>\nTipo: <b>${escTg(d.sug_slot_label)}</b>${venc}\n\nÉ documento <b>dessa pessoa (RH)</b> ou <b>da empresa (Jurídico)</b>?`,
      inline([
        [{ text: `✅ Anexar na ficha de ${primeiro}`.slice(0, 60), callback_data: "ganex:" + token }],
        [{ text: "🏢 É da empresa (Jurídico)", callback_data: "gemp:" + token }, { text: "🏷️ Outro tipo", callback_data: "gtipo:" + token }],
        [{ text: "❌ Descartar", callback_data: "gcancel:" + token }],
      ]));
  } else {
    await enviar(B, chatId,
      `📎 <b>${escTg(d.doc_nome)}</b> (${origem})\n❓ Não identifiquei a pessoa (RH). Se for documento da <b>empresa</b> (contrato/fornecedor — Jurídico), toque abaixo. Senão, renomeie com o nome da pessoa e reenvie.`,
      inline([
        [{ text: "🏢 É documento da empresa (Jurídico)", callback_data: "gemp:" + token }],
        [{ text: "❌ Descartar", callback_data: "gcancel:" + token }],
      ]));
  }
}

async function onCallbackGrupo(db: any, B: Bot, cq: any, chatId: number, data: string) {
  const acao = data.slice(0, data.indexOf(":"));
  const resto = data.slice(data.indexOf(":") + 1);
  const token = resto.split(":")[0];
  const { data: pend } = await db.from("telegram_sessoes").select("dados").eq("telegram_user_id", "gdoc:" + token).maybeSingle();
  const d = pend?.dados;
  if (!d) { await enviar(B, chatId, "Esse documento já foi tratado. 👍"); return; }

  if (acao === "gcancel") {
    await db.storage.from("rh").remove([d.doc_path]).catch(() => {});
    await db.from("telegram_sessoes").delete().eq("telegram_user_id", "gdoc:" + token);
    await enviar(B, chatId, "🗑️ Documento descartado.");
    return;
  }
  if (acao === "gtipo") {
    const linhas = SLOTS_DOC.map((s) => [{ text: s.label.slice(0, 60), callback_data: `gslot:${token}:${s.key}` }]);
    await enviar(B, chatId, "Qual o <b>tipo</b> do documento?", inline(linhas));
    return;
  }
  if (acao === "gslot") {
    const slot = slotPorKey(resto.split(":")[1]) || slotPorKey("outro")!;
    const nd = { ...d, sug_slot: slot.key, sug_slot_label: slot.label, sug_tem_validade: slot.validade };
    await db.from("telegram_sessoes").update({ dados: nd }).eq("telegram_user_id", "gdoc:" + token);
    await cardDocGrupo(B, chatId, token, nd);
    return;
  }
  if (acao === "ganex") {
    if (!d.sug_colab_id) { await enviar(B, chatId, "Sem pessoa definida — não dá pra anexar."); return; }
    const slot = slotPorKey(d.sug_slot) || slotPorKey("outro")!;
    const validade = d.sug_tem_validade ? (d.sug_validade || null) : null;
    const titulo = `${slot.prefixo} — ${d.doc_nome}`.slice(0, 200);
    const { data: row, error } = await db.from("rh_documentos").insert({
      colaborador_id: d.sug_colab_id, titulo, tipo: slot.tipo, storage_path: d.doc_path,
      validade, validade_na: !d.sug_tem_validade, criado_por: d.autor,
    }).select().single();
    if (error) { await enviar(B, chatId, "❌ Não anexou: " + escTg(error.message)); return; }
    await registrarAcao(db, { req: undefined as any, admin: { email: d.autor } as any }, {
      acao: "criar", entidade: "rh_documentos", registro_id: row?.id ?? null,
      descricao: `Telegram (grupo): anexou "${slot.label}" a ${d.sug_colab_nome}`, dados: { tipo: slot.tipo, validade },
    });
    await db.from("telegram_sessoes").delete().eq("telegram_user_id", "gdoc:" + token);
    const epiMsgG = slot.tipo === "ficha_epi" && d.sug_colab_id ? await epiDaFichaAnexada(db, d.sug_colab_id, d.doc_path, d.doc_nome) : "";
    await enviar(B, chatId, `✅ <b>Anexado!</b> ${escTg(slot.label)} → ficha de <b>${escTg(d.sug_colab_nome)}</b>. 🙌${epiMsgG}`);
    return;
  }
  // ── EMPRESA / JURÍDICO (doc_empresa + doc_empresa_arquivos) ──
  if (acao === "gemp") {
    const { data: emps } = await db.from("doc_empresa").select("id, nome").eq("arquivado", false).limit(3000);
    const lista = (emps || []).map((e: any) => ({ id: e.id, nome: e.nome }));
    const m = casarColaborador(`${d.doc_nome} ${d.ia_nome || ""}`, lista);
    if (!m) {
      await enviar(B, chatId, "🏢 Não consegui identificar a empresa/contrato pelo nome do arquivo. Anexe pelo painel <b>Documentos da Empresa</b> (Jurídico), ou renomeie o arquivo com o nome da empresa e reenvie.");
      return;
    }
    await db.from("telegram_sessoes").update({ dados: { ...d, emp_id: m.id, emp_nome: m.nome } }).eq("telegram_user_id", "gdoc:" + token);
    await enviar(B, chatId, `🏢 Anexar este documento ao cadastro da empresa <b>${escTg(m.nome)}</b>?`,
      inline([[{ text: "✅ Sim, anexar", callback_data: "gempok:" + token }], [{ text: "❌ Descartar", callback_data: "gcancel:" + token }]]));
    return;
  }
  if (acao === "gempok") {
    if (!d.emp_id) { await enviar(B, chatId, "Faltou a empresa — toque em 🏢 de novo."); return; }
    const { data: blob } = await db.storage.from("rh").download(d.doc_path);
    if (!blob) { await enviar(B, chatId, "❌ Não achei o arquivo. Reenvie o documento."); return; }
    const buf = Buffer.from(await blob.arrayBuffer());
    const ext = d.doc_path.split(".").pop() || "pdf";
    const newPath = `${d.emp_id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: eUp } = await db.storage.from("doc-empresa").upload(newPath, buf, { contentType: d.ct || "application/octet-stream", upsert: false });
    if (eUp) { await enviar(B, chatId, "❌ Falha ao mover o arquivo: " + escTg(eUp.message)); return; }
    const { data: row, error } = await db.from("doc_empresa_arquivos").insert({ doc_id: d.emp_id, nome: d.doc_nome, storage_path: newPath, criado_por: d.autor }).select().single();
    if (error) { await db.storage.from("doc-empresa").remove([newPath]).catch(() => {}); await enviar(B, chatId, "❌ Não anexou: " + escTg(error.message)); return; }
    await db.storage.from("rh").remove([d.doc_path]).catch(() => {});
    await registrarAcao(db, { req: undefined as any, admin: { email: d.autor } as any }, {
      acao: "criar", entidade: "doc_empresa_arquivos", registro_id: row?.id ?? null,
      descricao: `Telegram (grupo): anexou "${d.doc_nome}" ao documento da empresa ${d.emp_nome}`, dados: { doc_id: d.emp_id },
    });
    await db.from("telegram_sessoes").delete().eq("telegram_user_id", "gdoc:" + token);
    await enviar(B, chatId, `✅ <b>Anexado!</b> "${escTg(d.doc_nome)}" → empresa <b>${escTg(d.emp_nome)}</b> (Jurídico). 🙌`);
    return;
  }
}

// ── GRUPO da BASE DE CONHECIMENTO (texto → JunIA) ────────────────────────
async function onTextoKbGrupo(db: any, B: Bot, msg: any, chatId: number, texto: string) {
  let pergunta = "", resposta = "", categoria = "Geral";
  if (llmConfigurado()) {
    await enviar(B, chatId, "✨ Organizando…");
    try {
      const system = `Você organiza conhecimento interno da Costa Júnior Engenharia para um FAQ (a JunIA usa). A partir de um texto livre, gere UMA pergunta clara (como um colaborador perguntaria) e a resposta, em português, objetivo. Não invente além do texto. Responda APENAS JSON: {"pergunta":"...","resposta":"...","categoria":"Geral|Operacional|RH|Financeiro|Comercial|Administrativo"}`;
      const raw = await gerarTextoLLM(system, [{ role: "user", content: texto.slice(0, 4000) }]);
      const o = raw ? extrairJson(raw) : null;
      if (o && o.resposta) { pergunta = String(o.pergunta || "").trim(); resposta = String(o.resposta || "").trim(); categoria = String(o.categoria || "Geral").trim() || "Geral"; }
    } catch { /* cai no manual */ }
  }
  if (!resposta) {
    const i = texto.indexOf("|");
    if (i > 0) { pergunta = texto.slice(0, i).trim(); resposta = texto.slice(i + 1).trim(); }
    if (!resposta) { await enviar(B, chatId, "Não consegui organizar esse texto. Mande no formato <b>Pergunta | Resposta</b> (ou ative a IA na Caixa de Entrada)."); return; }
  }
  // checagem de duplicado/contradição na base + quem aprova
  const check = await checarBaseKb(db, pergunta, resposta);
  const info = await getGrupoBaseInfo(db);
  const aprovadorNome = info?.aprovador_nome || "o responsável";

  let aviso = "";
  if (check?.status === "duplicado") aviso = `\n\n⚠️ <b>Parece DUPLICADO</b> de: "${escTg(check.item)}".${check.motivo ? " " + escTg(check.motivo) : ""}`;
  else if (check?.status === "contradiz") aviso = `\n\n⛔ <b>CONTRADIZ a base</b>: "${escTg(check.item)}" (hoje diz: ${escTg(check.resposta_existente)}). Confira qual está certo antes de aprovar.`;

  const token = Date.now().toString(36);
  const autor = `${nomeRemetente(msg.from)} (via grupo Telegram)`;
  await salvarSessao(db, { telegram_user_id: "gkb:" + token, chat_id: String(chatId), estado: "pendente", dados: { kb_pergunta: pergunta, kb_resposta: resposta, kb_categoria: categoria, autor, aprovador_id: info?.aprovador_id || null } });
  await enviar(B, chatId,
    `📚 <b>Proposta para a base</b> (por ${escTg(nomeRemetente(msg.from))}):\n\n<b>P:</b> ${escTg(pergunta)}\n<b>R:</b> ${escTg(resposta)}\n<b>Categoria:</b> ${escTg(categoria)}${aviso}\n\n🔒 Aguardando aprovação de <b>${escTg(aprovadorNome)}</b>.`,
    inline([[{ text: "✅ Aprovar e salvar", callback_data: "gkbsave:" + token }], [{ text: "❌ Recusar", callback_data: "gkbcancel:" + token }]]));
}

async function onCallbackKbGrupo(db: any, B: Bot, cq: any, chatId: number, data: string) {
  const acao = data.slice(0, data.indexOf(":"));
  const token = data.slice(data.indexOf(":") + 1);
  const { data: pend } = await db.from("telegram_sessoes").select("dados").eq("telegram_user_id", "gkb:" + token).maybeSingle();
  const d = pend?.dados;
  if (!d) { await enviar(B, chatId, "Esse item já foi tratado. 👍"); return; }

  // só o aprovador (quem ativou o grupo) decide; fallback: admin do grupo (registro antigo sem aprovador)
  const tapId = cq?.from?.id;
  const podeAprovar = d.aprovador_id ? String(tapId) === String(d.aprovador_id) : await ehAdminGrupo(B, chatId, tapId);
  if (!podeAprovar) {
    const info = await getGrupoBaseInfo(db);
    await enviar(B, chatId, `🔒 Só <b>${escTg(info?.aprovador_nome || "quem ativou o grupo")}</b> pode aprovar/recusar o que sobe pra base.`);
    return;
  }

  if (acao === "gkbcancel") {
    await db.from("telegram_sessoes").delete().eq("telegram_user_id", "gkb:" + token);
    await enviar(B, chatId, "🗑️ Recusado — não foi pra base.");
    return;
  }
  const { data: row, error } = await db.from("portal_kb").insert({ question: d.kb_pergunta, answer: d.kb_resposta, category: d.kb_categoria || "Geral" }).select().single();
  if (error) { await enviar(B, chatId, "❌ Não salvou: " + escTg(error.message)); return; }
  await registrarAcao(db, { req: undefined as any, admin: { email: d.autor } as any }, {
    acao: "criar", entidade: "portal_kb", registro_id: row?.id ?? null,
    descricao: `Telegram (grupo base): aprovado e adicionado "${String(d.kb_pergunta).slice(0, 80)}"`, dados: { category: d.kb_categoria },
  });
  await db.from("telegram_sessoes").delete().eq("telegram_user_id", "gkb:" + token);
  await enviar(B, chatId, "✅ <b>Aprovado e salvo na base!</b> Já vale na JunIA. 🤖");
}

// ════════════════════════════════════════════════════════════════════════
// BOT da JunIA (@CjrJunIA_bot) — qualquer colaborador pergunta no privado.
// Identifica por telefone (LGPD: categorias do perfil). Sem resposta -> encaminha
// pro grupo da Base; o gestor responde (reply) e o bot devolve pro autor.
// ════════════════════════════════════════════════════════════════════════
async function onMessageJunia(db: any, B: Bot, msg: any) {
  const chatId = msg.chat.id;
  const userId = String(msg.from?.id || "");
  if (!userId) return;

  if (msg.contact) {
    if (String(msg.contact.user_id || "") !== userId) { await enviar(B, chatId, "Compartilhe o <b>seu próprio</b> contato, por favor.", botaoTelefone); return; }
    return await identificar(db, B, userId, chatId, msg.contact.phone_number);
  }

  const texto = String(msg.text || "").trim();
  const sessao = await getSessao(db, B, userId);
  if (!sessao?.dados?.colaborador_id) {
    await enviar(B, chatId, "Oi! 👋 Sou a <b>JunIA</b>, a inteligência da Costa Júnior. Pra eu te responder direitinho, preciso te identificar pelo seu telefone cadastrado.\n\nToque no botão abaixo:", botaoTelefone);
    return;
  }
  if (/^\/(start|ajuda|help|nova)/i.test(texto)) {
    await salvarSessao(db, { ...sessao, dados: { ...(sessao.dados || {}), hist: [] } }); // recomeça a conversa
    await enviar(B, chatId, "Pode perguntar! 🤖 Ex.: <i>\"qual o prazo do Santander?\"</i> ou <i>\"como nomear uma obra?\"</i>. Se eu não souber, encaminho pro time e te aviso aqui.\n\n(Mande <b>/nova</b> a qualquer momento pra recomeçar do zero.)");
    return;
  }
  if (!texto || texto.length < 3 || texto.startsWith("/")) return;
  return await responderPerguntaJunia(db, B, msg, chatId, sessao, texto);
}

async function claimsDeColaborador(db: any, colabId: string, email?: string | null): Promise<any> {
  let sub = "tg-" + colabId, role = "operacional", roles: string[] = ["operacional"], trabalhista = false;
  try {
    const { data: c } = await db.from("rh_colaboradores").select("profile_id").eq("id", colabId).maybeSingle();
    if (c?.profile_id) {
      const { data: p } = await db.from("portal_profiles").select("id, role, roles, tem_trabalhista").eq("id", c.profile_id).maybeSingle();
      if (p) { sub = p.id; role = p.role || role; roles = Array.isArray(p.roles) && p.roles.length ? p.roles : [role]; trabalhista = !!p.tem_trabalhista; }
    }
  } catch { /* usa defaults */ }
  return { sub, role, roles, trabalhista, email: email || null, tipo: "admin" };
}

async function responderPerguntaJunia(db: any, B: Bot, msg: any, chatId: number, sessao: Sessao, pergunta: string) {
  await tg(B, "sendChatAction", { chat_id: chatId, action: "typing" });
  const d = sessao.dados || {};
  const hist: HistMsg[] = Array.isArray(d.hist) ? d.hist : []; // memória da conversa (multi-turno)
  let r: any = null;
  try {
    const claims = await claimsDeColaborador(db, d.colaborador_id, d.colaborador_email);
    r = await responderJuniaIA(claims, pergunta, hist);
  } catch { r = null; }
  if (!r) { await enviar(B, chatId, "Tive um probleminha agora 🙏 tente de novo daqui a pouco."); return; }

  let resp: string;
  if (r.precisaResposta) {
    const ok = await encaminharPergunta(db, chatId, d, pergunta);
    resp = ok
      ? "🔎 Ainda não tenho essa resposta cadastrada. Encaminhei pro time e te aviso aqui assim que responderem!"
      : "🔎 Ainda não tenho essa resposta. Vou verificar com o time e te retorno.";
    await enviar(B, chatId, resp);
  } else {
    resp = r.resposta;
    // se a resposta tiver link de treinamento, vira botão p/ o player com marca d'água
    const { texto: tl, botoes } = await resolverTreinoTelegram(db, resp, d.colaborador_nome || "Colaborador");
    const teclado = botoes.length ? { inline_keyboard: botoes.map((b) => [b]) } : undefined;
    await enviar(B, chatId, escTg(tl), teclado);
  }
  // guarda as últimas trocas (4 turnos) p/ a JunIA entender follow-ups ("Itaú", "vencimento"...)
  const novaHist = [...hist, { role: "user", content: pergunta }, { role: "assistant", content: resp }].slice(-8) as HistMsg[];
  await salvarSessao(db, { ...sessao, dados: { ...d, hist: novaHist } });
}

// Posta a pergunta sem resposta no grupo da Base (via bot adm) e guarda o pendente
// pela message_id da mensagem do grupo. true se conseguiu encaminhar.
async function encaminharPergunta(db: any, askerChatId: number, d: any, pergunta: string): Promise<boolean> {
  const info = await getGrupoBaseInfo(db);
  const base = info?.chat_id;
  if (!base) return false;
  // posta no grupo da base usando o bot que ATIVOU o grupo (junia ou adm)
  const grpBot = botPorModo(info.bot_modo === "junia" ? "junia" : "adm");
  const nome = d.colaborador_nome || "colaborador";
  const primeiro = String(nome).split(" ")[0];
  const enviado = await enviar(grpBot, base,
    `❓ <b>Pergunta sem resposta na base</b>\nDe: <b>${escTg(nome)}</b>\n\n"${escTg(pergunta)}"\n\n↩️ <b>Responda ESTA mensagem</b> com a resposta — eu envio pro ${escTg(primeiro)} e proponho adicionar à base.`);
  const msgId = enviado?.result?.message_id;
  if (!msgId) return false;
  await salvarSessao(db, { telegram_user_id: "pq:" + msgId, chat_id: String(base), estado: "pendente", dados: { pergunta, asker_chat_id: askerChatId, asker_nome: nome } });
  return true;
}

// Gestor respondeu (reply) no grupo da Base → manda pro autor (bot JunIA) e propõe base.
async function responderPerguntaEncaminhada(db: any, B: Bot, msg: any, chatId: number, msgId: number, pq: any, resposta: string) {
  const juniaBot = botPorModo("junia");
  const r = await enviar(juniaBot, pq.asker_chat_id,
    `🤖 <b>Resposta para a sua pergunta:</b>\n\n<i>"${escTg(pq.pergunta)}"</i>\n\n${escTg(resposta)}`);
  await db.from("telegram_sessoes").delete().eq("telegram_user_id", "pq:" + msgId);
  if (r?.ok === false) await enviar(B, chatId, `⚠️ Não consegui enviar para <b>${escTg(pq.asker_nome)}</b> (pode ter parado o bot). Resposta: "${escTg(resposta)}"`);
  else await enviar(B, chatId, `✅ Resposta enviada para <b>${escTg(pq.asker_nome)}</b>.`);
  await proporKbDireto(db, B, chatId, msg, pq.pergunta, resposta);
}

// Proposta de base com P/R já conhecidos (resposta do gestor) + checagem + aprovação.
async function proporKbDireto(db: any, B: Bot, chatId: number, msg: any, pergunta: string, resposta: string) {
  const categoria = detectarCategoria(pergunta) || "Geral";
  const check = await checarBaseKb(db, pergunta, resposta);
  const info = await getGrupoBaseInfo(db);
  let aviso = "";
  if (check?.status === "duplicado") aviso = `\n⚠️ Parece duplicado de: "${escTg(check.item)}".`;
  else if (check?.status === "contradiz") aviso = `\n⛔ Contradiz: "${escTg(check.item)}".`;
  const token = Date.now().toString(36);
  await salvarSessao(db, { telegram_user_id: "gkb:" + token, chat_id: String(chatId), estado: "pendente", dados: { kb_pergunta: pergunta, kb_resposta: resposta, kb_categoria: categoria, autor: `${nomeRemetente(msg.from)} (via grupo Telegram)`, aprovador_id: info?.aprovador_id || null } });
  await enviar(B, chatId,
    `📚 Adicionar essa resposta à base da JunIA?\n<b>P:</b> ${escTg(pergunta)}\n<b>R:</b> ${escTg(resposta)}\n<b>Categoria:</b> ${escTg(categoria)}${aviso}`,
    inline([[{ text: "✅ Aprovar e salvar", callback_data: "gkbsave:" + token }], [{ text: "❌ Não adicionar", callback_data: "gkbcancel:" + token }]]));
}
