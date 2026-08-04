// ════════════════════════════════════════════════════════════════════════
// Fluxo "Comercial" — hoje acessível de dentro da própria JunIA (@CjrJunIA_bot,
// modo "junia": comando /comercial ou botão após identificação). Também dá
// suporte a um bot "processos" dedicado (modo "processos"), caso a Adriana
// decida separar depois — mas por ora o plano é "a JunIA faz tudo", um único
// assistente (decisão de 30/07/2026, ver histórico da sessão).
// Primeira área implementada do assistente multi-departamento da Costa Júnior
// (financeiro/operacional entram depois).
//
// Acesso restrito: só quem tem perfil "comercial" (ou "admin") no Portal.
//
// Roteiro (decidido com a Adriana em 30/07/2026):
//   cliente → endereço → tem projeto? (anexa ou não) → tem planilha padrão?
//   (anexa ou não) → escopo curto → escopo detalhado (opcional) → prazo obra
//   (opcional) → prazo mobilização (opcional) → valor (opcional) → CONFIRMA
//   → gera a Proposta em PowerPoint (modelo real da empresa) + cria a
//   oportunidade na Vobi (aba Oportunidades) + manda o arquivo aqui no chat.
//
// A quantificação automática do projeto (2ª etapa, ainda não implementada)
// SEMPRE vai gerar um RASCUNHO dentro da Vobi pra um engenheiro revisar antes
// de virar orçamento oficial — nunca envia nada oficial sozinha.
// ════════════════════════════════════════════════════════════════════════
import { escTg } from "./telegram";
import {
  type Bot, type Sessao,
  enviar, inline, btnCancelar,
  getSessao, salvarSessao, identificar, baixarArquivoTg,
} from "./telegramBot";
import { gerarPropostaPptx, COMERCIAL_BUCKET, type DadosProposta } from "./propostaPptx";
import { vobiEscritaConfigurada, vobiCriarOportunidade, vobiMudarEtapa } from "./vobiEscrita";
import { supabaseAdmin } from "./supabase";

// Converte texto livre em reais ("R$ 594.696,95", "594696,95", "594696.95")
// pra número. Retorna null se não conseguir interpretar.
function parseValorReais(texto: string): number | null {
  const limpo = String(texto || "").replace(/[^\d.,]/g, "");
  if (!limpo) return null;
  // formato BR "594.696,95" (ponto=milhar, vírgula=decimal)
  let normalizado = limpo;
  if (limpo.includes(",")) normalizado = limpo.replace(/\./g, "").replace(",", ".");
  const n = Number(normalizado);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function formatarValorRemuneracao(valorTotalTexto: string, pctSinal: number, pctMedicao: number, pctEntrega: number): string {
  return `VALOR ESTIMADO: ${valorTotalTexto}\nSINAL: ${pctSinal}% na assinatura\nMEDIÇÃO: ${pctMedicao}% ao longo da execução\nENTREGA: ${pctEntrega}% na conclusão`;
}

// ── Permissão: só perfil "comercial" (ou "admin") ───────────────────────
export async function ehComercial(db: any, colaboradorId: string): Promise<boolean> {
  try {
    if (!colaboradorId) return false;
    const { data: c } = await db.from("rh_colaboradores").select("profile_id").eq("id", colaboradorId).maybeSingle();
    if (!c?.profile_id) return false;
    const { data: p } = await db.from("portal_profiles").select("role, roles").eq("id", c.profile_id).maybeSingle();
    const roles = [p?.role, ...(Array.isArray(p?.roles) ? p.roles : [])].filter(Boolean);
    return roles.includes("admin") || roles.includes("comercial");
  } catch { return false; }
}

const idBaseDe = (d: any) => ({ colaborador_id: d.colaborador_id, colaborador_nome: d.colaborador_nome, colaborador_email: d.colaborador_email });

// ── Menu de áreas (chamado por identificar() no modo "processos") ──────
export async function mostrarMenuAreas(db: any, B: Bot, chatId: number, sessKey: string, dados: any) {
  const nome = dados?.colaborador_nome || "colega";
  if (!(await ehComercial(db, dados?.colaborador_id))) {
    await enviar(B, chatId,
      `Oi, <b>${escTg(nome)}</b>! Este bot ainda só atende o time <b>Comercial</b>. Se você precisa de acesso, fale com a Adriana.`);
    return;
  }
  await salvarSessao(db, { telegram_user_id: sessKey, nome, chat_id: String(chatId), estado: "proc_menu", dados: idBaseDe(dados) });
  await enviar(B, chatId, `Olá, <b>${escTg(nome)}</b>! 👋\nQual área você quer usar?`, inline([
    [{ text: "💼 Comercial", callback_data: "area:comercial" }],
    [{ text: "💰 Financeiro (em breve)", callback_data: "area:embreve" }],
    [{ text: "🏗️ Operacional (em breve)", callback_data: "area:embreve" }],
  ]));
}

export async function mostrarMenuComercial(db: any, B: Bot, sessao: Sessao, chatId: number) {
  await salvarSessao(db, { ...sessao, estado: "proc_menu", dados: idBaseDe(sessao.dados || {}) });
  await enviar(B, chatId, "💼 <b>Comercial</b> — o que você quer fazer?", inline([
    [{ text: "📋 Nova proposta comercial", callback_data: "com:nova" }],
  ]));
}

function pergunta(texto: string, pularCb?: string) {
  return { texto, botoes: pularCb ? inline([[{ text: "⏭️ Pular", callback_data: pularCb }], btnCancelar]) : inline([btnCancelar]) };
}

// Inicia o roteiro (chamado pelo botão "Nova proposta comercial" e pelo
// comando /comercial — tanto no bot de Processos quanto de dentro da JunIA).
export async function iniciarNovaProposta(db: any, B: Bot, sessao: Sessao, chatId: number) {
  await salvarSessao(db, { ...sessao, estado: "com_cliente", dados: idBaseDe(sessao.dados) });
  await enviar(B, chatId, "📋 <b>Nova proposta comercial</b>\n\nQual o <b>nome do cliente</b>?", inline([btnCancelar]));
}

// ── Passos de texto do roteiro (estado com_*) — compartilhado entre o bot
// de Processos e o atalho "/comercial" dentro da JunIA. ──
async function onTextoComercial(db: any, B: Bot, sessao: Sessao, chatId: number, estado: string, texto: string) {
  switch (estado) {
    case "com_cliente":
      return await avancar(db, B, sessao, chatId, { cliente: texto }, "com_endereco",
        "📍 Qual o <b>endereço</b> da obra/projeto?");
    case "com_endereco":
      return await avancar(db, B, sessao, chatId, { endereco: texto }, "com_projeto",
        "📎 Você já tem o <b>projeto</b> (planta/arquivo) desse serviço? Se sim, me envie o arquivo. Se não tiver, toque em pular.", "com:pular_projeto");
    case "com_escopo_curto":
      return await avancar(db, B, sessao, chatId, { escopoCurto: texto }, "com_escopo_detalhado",
        "📝 Quer <b>detalhar o escopo</b> (linha por linha, o que inclui)? Pode mandar o texto, ou pular.", "com:pular_escopo");
    case "com_escopo_detalhado":
      return await avancar(db, B, sessao, chatId, { escopoDetalhado: texto }, "com_prazo_obra",
        "🗓️ Qual o <b>prazo de obra</b> estimado (em dias úteis)? Se não souber ainda, pode pular (mantenho o padrão de 10 dias).", "com:pular_prazo_obra");
    case "com_prazo_obra": {
      const n = texto.replace(/\D/g, "");
      if (!n) { await enviar(B, chatId, "Manda só o número de dias (ex.: 15), ou toque em pular."); return; }
      const perguntaMob = B.modo === "comercial"
        ? "🚚 E o <b>prazo de mobilização</b> (dias úteis)? Mínimo de <b>10 dias úteis</b> — pode pular (fico com 10)."
        : "🚚 E o <b>prazo de mobilização</b> (dias úteis)? Pode pular (padrão de 5 dias).";
      return await avancar(db, B, sessao, chatId, { prazoObraDias: n }, "com_prazo_mob", perguntaMob, "com:pular_prazo_mob");
    }
    case "com_prazo_mob": {
      const n = texto.replace(/\D/g, "");
      if (!n) { await enviar(B, chatId, "Manda só o número de dias (ex.: 10), ou toque em pular."); return; }
      if (B.modo === "comercial" && Number(n) < 10) {
        await enviar(B, chatId, "⚠️ A mobilização mínima é de <b>10 dias úteis</b>. Manda um número igual ou maior, ou toque em pular (fico com 10).");
        return;
      }
      const perguntaValor = B.modo === "comercial"
        ? "💰 Qual o <b>valor</b> da proposta? (ex.: \"R$ 38.500,00\")"
        : "💰 Já tem um <b>valor</b> pra propor? Pode mandar (ex.: \"R$ 38.500,00\"), ou pular (fica \"conforme negociação\").";
      return await avancar(db, B, sessao, chatId, { prazoMobilizacaoDias: n }, "com_valor",
        perguntaValor, B.modo === "comercial" ? undefined : "com:pular_valor");
    }
    case "com_valor": {
      if (B.modo === "comercial") {
        const valorNumerico = parseValorReais(texto);
        if (!valorNumerico) { await enviar(B, chatId, "Não consegui entender esse valor. Manda algo como \"R$ 594.696,95\"."); return; }
        return await avancar(db, B, sessao, chatId, { valorTotalTexto: texto, valorNumerico }, "com_pct_sinal",
          "💰 Perfeito. Agora o <b>% de sinal</b> (na assinatura)? Manda só o número (ex.: 30).");
      }
      await salvarSessao(db, { ...sessao, estado: "com_confirma", dados: { ...sessao.dados, valor: texto } });
      return await mostrarConfirmacao(db, B, chatId, { ...sessao.dados, valor: texto });
    }
    case "com_pct_sinal": {
      const n = Number(texto.replace(",", ".").replace(/[^\d.]/g, ""));
      if (!n || n <= 0 || n >= 100) { await enviar(B, chatId, "Manda só o número do percentual de sinal (ex.: 30)."); return; }
      return await avancar(db, B, sessao, chatId, { pctSinal: n }, "com_pct_medicao",
        "📐 E o <b>% de medição</b> (ao longo da execução)?");
    }
    case "com_pct_medicao": {
      const n = Number(texto.replace(",", ".").replace(/[^\d.]/g, ""));
      if (!n || n <= 0 || n >= 100) { await enviar(B, chatId, "Manda só o número do percentual de medição (ex.: 40)."); return; }
      return await avancar(db, B, sessao, chatId, { pctMedicao: n }, "com_pct_entrega",
        "🏁 E o <b>% de entrega</b> (na conclusão)?");
    }
    case "com_pct_entrega": {
      const n = Number(texto.replace(",", ".").replace(/[^\d.]/g, ""));
      if (!n || n <= 0 || n >= 100) { await enviar(B, chatId, "Manda só o número do percentual de entrega (ex.: 30)."); return; }
      const soma = (Number(sessao.dados?.pctSinal) || 0) + (Number(sessao.dados?.pctMedicao) || 0) + n;
      if (Math.abs(soma - 100) > 0.01) {
        await enviar(B, chatId, `⚠️ Sinal + Medição + Entrega precisa somar <b>100%</b> (deu ${soma}%). Manda o % de entrega certo.`);
        return;
      }
      const valorFormatado = formatarValorRemuneracao(sessao.dados.valorTotalTexto, sessao.dados.pctSinal, sessao.dados.pctMedicao, n);
      const novosDados = { ...sessao.dados, pctEntrega: n, valor: valorFormatado };
      await salvarSessao(db, { ...sessao, estado: "com_confirma", dados: novosDados });
      return await mostrarConfirmacao(db, B, chatId, novosDados);
    }
    default:
      return; // com_confirma etc — só reage a botão, texto solto é ignorado
  }
}

// Roteiro exclusivo do bot Comercial dedicado (@cjrcomercial_bot, modo
// "comercial") — sem menu de áreas (esse bot só atende Comercial) e sem
// atalho pra dentro da JunIA. Separado de onMessageProcessos de propósito:
// as regras de negócio deste bot (mobilização mínima, remuneração em 3
// percentuais, valor de ganho na Vobi) são diferentes das do JunIA/Processos
// (decisão da Adriana, 2026-08-04 — "estará fora da JunIA").
export async function onMessageComercial(db: any, B: Bot, msg: any) {
  const chat = msg.chat;
  if (!chat || chat.type !== "private") return;
  const userId = String(msg.from?.id || "");
  const chatId = chat.id;
  if (!userId) return;

  if (msg.contact) {
    if (String(msg.contact.user_id || "") !== userId) { await enviar(B, chatId, "Compartilhe o <b>seu próprio</b> contato, por favor."); return; }
    return await identificar(db, B, userId, chatId, msg.contact.phone_number);
  }

  const sessao = await getSessao(db, B, userId);
  if (!sessao?.dados?.colaborador_id) {
    await enviar(B, chatId, "👋 <b>Bot Comercial — Costa Júnior</b>\n\nPreciso te identificar pelo seu telefone cadastrado primeiro. Toque em /start.");
    return;
  }
  const texto = String(msg.text || "").trim();
  if (/^\/cancelar/i.test(texto)) return await mostrarMenuComercial(db, B, sessao, chatId);
  if (/^\/(start|menu)/i.test(texto)) return await mostrarMenuComercial(db, B, sessao, chatId);
  if (/^\/etapa/i.test(texto) || /mudar\s+de\s+etapa/i.test(texto)) return await perguntarEtapa(db, B, sessao, chatId);

  const estado = sessao.estado || "pronto";
  if (msg.photo || msg.document) {
    if (estado === "com_projeto" || estado === "com_planilha") return await onArquivoRoteiro(db, B, sessao, chatId, msg, estado);
    await enviar(B, chatId, "Não esperava um arquivo agora — se quiser recomeçar, mande /cancelar.");
    return;
  }
  if (!texto) return;
  if (estado.startsWith("com_")) return await onTextoComercial(db, B, sessao, chatId, estado, texto);
  return await mostrarMenuComercial(db, B, sessao, chatId);
}

// ── Comando "pode mudar de etapa" (Adriana, 2026-08-04) — só no bot
// Comercial dedicado. Age sobre a ÚLTIMA oportunidade criada nesta conversa
// (guardada em dados.ultimoIdRefurbish pelo executarProposta). ──
async function perguntarEtapa(db: any, B: Bot, sessao: Sessao, chatId: number) {
  const idRefurbish = sessao.dados?.ultimoIdRefurbish;
  if (!idRefurbish) {
    await enviar(B, chatId, "Não achei nenhuma oportunidade criada por aqui ainda nesta conversa. Gere uma proposta primeiro (/menu).");
    return;
  }
  await enviar(B, chatId, `🔀 Mudar a etapa de <b>${escTg(sessao.dados?.ultimoNomeOportunidade || `oportunidade ${idRefurbish}`)}</b> — para <b>Visita</b> ou para <b>Em Orçamento</b>?`, inline([
    [{ text: "🚶 Visita", callback_data: `etapa:visita:${idRefurbish}` }],
    [{ text: "💰 Em Orçamento", callback_data: `etapa:orcamento:${idRefurbish}` }],
    btnCancelar,
  ]));
}

// Callback do comando de etapa — chamado direto pelo onCallback do
// telegramBot.ts quando B.modo === "comercial" e data começa com "etapa:".
export async function onCallbackEtapa(db: any, B: Bot, sessao: Sessao | null, chatId: number, data: string) {
  if (!sessao?.dados?.colaborador_id) { await enviar(B, chatId, "Sessão expirada. Toque em /start."); return; }
  if (data === "cancel") { await enviar(B, chatId, "Ok, sem mudança de etapa."); return; }
  const partes = data.split(":"); // etapa:visita:123  |  etapa:orcamento:123
  const acao = partes[1];
  const idRefurbish = Number(partes[2]);
  if (!idRefurbish) { await enviar(B, chatId, "Não identifiquei qual oportunidade — recomeça com /etapa."); return; }
  try {
    if (acao === "visita") {
      await vobiMudarEtapa(idRefurbish, "VISITA");
      await enviar(B, chatId, "🚶 Etapa alterada para <b>Visita</b>. O orçamento continua como estava — nada foi enviado ao cliente.");
      return;
    }
    if (acao === "orcamento") {
      await vobiMudarEtapa(idRefurbish, "EM ORÇAMENTO");
      await enviar(B, chatId, "💰 Etapa alterada para <b>Em Orçamento</b>. O valor de ganho já está gravado na Oportunidade.");
      return;
    }
  } catch (e: any) {
    await enviar(B, chatId, `⚠️ Não consegui confirmar a mudança de etapa na Vobi: ${escTg(e?.message || e)}. Confira manualmente por lá.`);
  }
}

// Roteiro completo (identificação + menu) — usado pelo bot de Processos.
export async function onMessageProcessos(db: any, B: Bot, msg: any) {
  const chat = msg.chat;
  if (!chat || chat.type !== "private") return;
  const userId = String(msg.from?.id || "");
  const chatId = chat.id;
  if (!userId) return;

  if (msg.contact) {
    if (String(msg.contact.user_id || "") !== userId) { await enviar(B, chatId, "Compartilhe o <b>seu próprio</b> contato, por favor."); return; }
    return await identificar(db, B, userId, chatId, msg.contact.phone_number);
  }

  const sessao = await getSessao(db, B, userId);
  if (!sessao?.dados?.colaborador_id) {
    await enviar(B, chatId, "👋 <b>Bot de Processos — Costa Júnior</b>\n\nPreciso te identificar pelo seu telefone cadastrado primeiro. Toque em /start.");
    return;
  }
  const texto = String(msg.text || "").trim();
  if (/^\/cancelar/i.test(texto)) return await mostrarMenuComercial(db, B, sessao, chatId);
  if (/^\/(start|menu)/i.test(texto)) return await mostrarMenuAreas(db, B, chatId, sessao.telegram_user_id, sessao.dados);

  const estado = sessao.estado || "proc_menu";

  if (msg.photo || msg.document) {
    if (estado === "com_projeto" || estado === "com_planilha") return await onArquivoRoteiro(db, B, sessao, chatId, msg, estado);
    await enviar(B, chatId, "Não esperava um arquivo agora — se quiser recomeçar, mande /cancelar.");
    return;
  }
  if (!texto) return;
  if (estado.startsWith("com_")) return await onTextoComercial(db, B, sessao, chatId, estado, texto);
  return await mostrarMenuAreas(db, B, chatId, sessao.telegram_user_id, sessao.dados);
}

// Só o roteiro (sem identificação/menu de áreas) — usado de dentro da JunIA,
// que já cuida da identificação e do resto do chat livre. Retorna true se a
// mensagem foi tratada aqui (ou seja, o chamador NÃO deve cair no chat livre).
export async function onMessageComercialRoteiro(db: any, B: Bot, sessao: Sessao, chatId: number, msg: any): Promise<boolean> {
  const estado = sessao.estado || "";
  if (!estado.startsWith("com_")) return false;

  const texto = String(msg.text || "").trim();
  if (/^\/cancelar/i.test(texto)) {
    await salvarSessao(db, { ...sessao, estado: "pronto", dados: idBaseDe(sessao.dados || {}) });
    await enviar(B, chatId, "Ok, proposta cancelada. Pode me perguntar qualquer outra coisa. 🙂");
    return true;
  }
  if (msg.photo || msg.document) {
    if (estado === "com_projeto" || estado === "com_planilha") { await onArquivoRoteiro(db, B, sessao, chatId, msg, estado); return true; }
    await enviar(B, chatId, "Não esperava um arquivo agora — se quiser recomeçar a proposta, mande /cancelar.");
    return true;
  }
  if (!texto) return true;
  await onTextoComercial(db, B, sessao, chatId, estado, texto);
  return true;
}

async function avancar(db: any, B: Bot, sessao: Sessao, chatId: number, patch: any, proximoEstado: string, textoPergunta: string, pularCb?: string) {
  const dados = { ...sessao.dados, ...patch };
  await salvarSessao(db, { ...sessao, estado: proximoEstado, dados });
  const { texto, botoes } = pergunta(textoPergunta, pularCb);
  await enviar(B, chatId, texto, botoes);
}

async function onArquivoRoteiro(db: any, B: Bot, sessao: Sessao, chatId: number, msg: any, estado: "com_projeto" | "com_planilha") {
  let fileId = "", nome = "arquivo", ct = "application/octet-stream";
  if (msg.document) { fileId = msg.document.file_id; nome = msg.document.file_name || "arquivo"; ct = msg.document.mime_type || ct; }
  else if (msg.photo?.length) { fileId = msg.photo[msg.photo.length - 1].file_id; nome = "foto-telegram.jpg"; ct = "image/jpeg"; }
  if (!fileId) { await enviar(B, chatId, "Não consegui ler esse arquivo."); return; }
  await enviar(B, chatId, "📎 Recebendo…");
  const buf = await baixarArquivoTg(B, fileId);
  if (!buf) { await enviar(B, chatId, "❌ Não consegui baixar o arquivo. Tente de novo, ou pule."); return; }
  const db2 = supabaseAdmin();
  const ext = (nome.includes(".") ? nome.split(".").pop() : "")?.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const campo = estado === "com_projeto" ? "projeto" : "planilha";
  const storagePath = `propostas/tmp-${Date.now()}-${campo}.${ext}`;
  const { error } = await db2.storage.from(COMERCIAL_BUCKET).upload(storagePath, buf, { contentType: ct, upsert: false });
  const patch: any = {};
  if (!error) patch[`${campo}Path`] = storagePath;
  if (estado === "com_projeto") {
    return await avancar(db, B, sessao, chatId, patch, "com_planilha",
      error ? "⚠️ Não consegui guardar o projeto, mas seguimos — você anexa depois direto na Vobi.\n\n📊 Tem uma <b>planilha de orçamento padrão</b> pra esse tipo de serviço? Envie ou pule."
            : "✅ Projeto guardado — o engenheiro revisa depois.\n\n📊 Tem uma <b>planilha de orçamento padrão</b> pra esse tipo de serviço? Envie ou pule.",
      "com:pular_planilha");
  }
  return await avancar(db, B, sessao, chatId, patch, "com_escopo_curto",
    error ? "⚠️ Não consegui guardar a planilha, mas seguimos.\n\n✏️ Resuma em <b>uma frase</b> o escopo do serviço (ex.: \"Impermeabilização da laje de cobertura do bloco B\"):"
          : "✅ Planilha guardada.\n\n✏️ Resuma em <b>uma frase</b> o escopo do serviço (ex.: \"Impermeabilização da laje de cobertura do bloco B\"):");
}

// ── Callbacks (botões) ──────────────────────────────────────────────────
export async function onCallbackProcessos(db: any, B: Bot, sessao: Sessao | null, chatId: number, userId: string, data: string) {
  if (!sessao?.dados?.colaborador_id) { await enviar(B, chatId, "Sessão expirada. Toque em /start."); return; }
  if (data === "cancel") return await mostrarMenuComercial(db, B, sessao, chatId);
  if (data === "area:embreve") { await enviar(B, chatId, "🚧 Ainda não disponível — só o Comercial por enquanto."); return; }
  if (data === "area:comercial" || data === "com:nova") {
    if (!(await ehComercial(db, sessao.dados.colaborador_id))) { await enviar(B, chatId, "Recurso restrito ao time Comercial."); return; }
  }
  if (data === "area:comercial") return await mostrarMenuComercial(db, B, sessao, chatId);
  if (data === "com:nova") return await iniciarNovaProposta(db, B, sessao, chatId);
  if (data === "com:pular_projeto") return await avancar(db, B, sessao, chatId, {}, "com_planilha",
    "📊 Tem uma <b>planilha de orçamento padrão</b> pra esse tipo de serviço? Envie ou pule.", "com:pular_planilha");
  if (data === "com:pular_planilha") return await avancar(db, B, sessao, chatId, {}, "com_escopo_curto",
    "✏️ Resuma em <b>uma frase</b> o escopo do serviço (ex.: \"Impermeabilização da laje de cobertura do bloco B\"):");
  if (data === "com:pular_escopo") return await avancar(db, B, sessao, chatId, {}, "com_prazo_obra",
    "🗓️ Qual o <b>prazo de obra</b> estimado (em dias úteis)? Pode pular (padrão de 10 dias).", "com:pular_prazo_obra");
  if (data === "com:pular_prazo_obra") {
    const perguntaMob = B.modo === "comercial"
      ? "🚚 E o <b>prazo de mobilização</b> (dias úteis)? Mínimo de <b>10 dias úteis</b> — pode pular (fico com 10)."
      : "🚚 E o <b>prazo de mobilização</b> (dias úteis)? Pode pular (padrão de 5 dias).";
    return await avancar(db, B, sessao, chatId, {}, "com_prazo_mob", perguntaMob, "com:pular_prazo_mob");
  }
  if (data === "com:pular_prazo_mob") {
    const patch = B.modo === "comercial" ? { prazoMobilizacaoDias: "10" } : {};
    const perguntaValor = B.modo === "comercial" ? "💰 Qual o <b>valor</b> da proposta? (ex.: \"R$ 38.500,00\")" : "💰 Já tem um <b>valor</b> pra propor? Pode mandar, ou pular.";
    return await avancar(db, B, sessao, chatId, patch, "com_valor", perguntaValor, B.modo === "comercial" ? undefined : "com:pular_valor");
  }
  if (data === "com:pular_valor") {
    await salvarSessao(db, { ...sessao, estado: "com_confirma", dados: sessao.dados });
    return await mostrarConfirmacao(db, B, chatId, sessao.dados);
  }
  if (data === "com:confirmar") return await executarProposta(db, B, sessao, chatId);
}

function resumoLinha(label: string, valor?: string, padrao?: string): string {
  if (valor) return `${label}: <b>${escTg(valor)}</b>`;
  return `${label}: <i>não informado${padrao ? ` (mantém ${escTg(padrao)})` : ""}</i>`;
}

async function mostrarConfirmacao(db: any, B: Bot, chatId: number, dados: any) {
  const linhas = [
    resumoLinha("Cliente", dados.cliente),
    resumoLinha("Endereço", dados.endereco),
    resumoLinha("Projeto anexado", dados.projetoPath ? "sim" : undefined, "sem projeto anexado"),
    resumoLinha("Planilha padrão", dados.planilhaPath ? "sim" : undefined, "sem planilha"),
    resumoLinha("Escopo", dados.escopoCurto),
    resumoLinha("Detalhamento", dados.escopoDetalhado, "fica marcado p/ ajustar depois"),
    resumoLinha("Prazo de obra", dados.prazoObraDias ? `${dados.prazoObraDias} dias úteis` : undefined, "10 dias úteis"),
    resumoLinha("Mobilização", dados.prazoMobilizacaoDias ? `${dados.prazoMobilizacaoDias} dias úteis` : undefined, B.modo === "comercial" ? "10 dias úteis" : "5 dias úteis"),
    resumoLinha("Valor", dados.valor, "conforme negociação"),
  ].join("\n");
  await enviar(B, chatId,
    `📋 <b>Confirma os dados da proposta?</b>\n\n${linhas}\n\nAo confirmar, eu gero o PowerPoint da proposta e já crio a oportunidade na Vobi.`,
    inline([[{ text: "✅ Confirmar e gerar", callback_data: "com:confirmar" }], btnCancelar]));
}

async function enviarDocumentoTg(B: Bot, chatId: number, buffer: Buffer, filename: string, caption?: string): Promise<any> {
  if (!B.token) return { ok: false };
  try {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    if (caption) { form.append("caption", caption); form.append("parse_mode", "HTML"); }
    form.append("document", new Blob([new Uint8Array(buffer)], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }), filename);
    const r = await fetch(`https://api.telegram.org/bot${B.token}/sendDocument`, { method: "POST", body: form });
    return await r.json().catch(() => ({}));
  } catch { return { ok: false }; }
}

async function executarProposta(db: any, B: Bot, sessao: Sessao, chatId: number) {
  const d = sessao.dados || {};
  await enviar(B, chatId, "⏳ Gerando a proposta e criando a oportunidade na Vobi…");

  const dadosProposta: DadosProposta = {
    cliente: d.cliente, endereco: d.endereco, escopoCurto: d.escopoCurto,
    escopoDetalhado: d.escopoDetalhado, prazoObraDias: d.prazoObraDias,
    prazoMobilizacaoDias: d.prazoMobilizacaoDias, valor: d.valor,
  };

  let pptx: { buffer: Buffer; nomeArquivo: string; pendencias: string[] } | null = null;
  try {
    pptx = await gerarPropostaPptx(dadosProposta);
  } catch (e: any) {
    await enviar(B, chatId, `❌ Não consegui gerar o PowerPoint: ${escTg(e?.message || e)}\n\nAvise a Adriana — provavelmente o modelo ainda não foi carregado no sistema.`);
  }

  let vobiMsg = "";
  let dadosFinais: any = idBaseDe(d);
  if (vobiEscritaConfigurada()) {
    try {
      const r = await vobiCriarOportunidade({
        nomeCliente: d.cliente,
        escopoResumo: d.escopoCurto,
        enderecoTexto: d.endereco,
        ...(B.modo === "comercial" && d.valorNumerico ? { valorGanho: d.valorNumerico } : {}),
      });
      const valorMsg = B.modo === "comercial"
        ? (d.valorNumerico ? (r.valorGravado ? " Valor de ganho gravado." : " ⚠️ não consegui confirmar o valor de ganho, confira lá dentro.") : "")
        : "";
      vobiMsg = `\n\n🏗️ Oportunidade criada na Vobi (id ${r.idRefurbish})${r.stepEncontrada ? "" : " — não achei a etapa \"NOVA\", conferir a etapa lá dentro"}.${valorMsg}`;
      if (B.modo === "comercial") {
        dadosFinais = { ...dadosFinais, ultimoIdRefurbish: r.idRefurbish, ultimoNomeOportunidade: `${d.cliente} - ${d.escopoCurto}` };
        vobiMsg += `\n\nQuando quiser mudar a etapa (Visita ou Em Orçamento), é só mandar <b>/etapa</b>.`;
      }
    } catch (e: any) {
      vobiMsg = `\n\n⚠️ Não consegui criar a oportunidade na Vobi: ${escTg(e?.message || e)}. Crie manualmente por lá.`;
    }
  } else {
    vobiMsg = "\n\n⚠️ Integração com a Vobi não está configurada — crie a oportunidade manualmente por lá.";
  }

  if (pptx) {
    await enviarDocumentoTg(B, chatId, pptx.buffer, pptx.nomeArquivo, "📄 Proposta gerada — confira antes de exportar o PDF e enviar ao cliente.");
    const pend = pptx.pendencias.length ? `\n\n📌 <b>Ainda precisa ajustar:</b>\n• ${pptx.pendencias.map(escTg).join("\n• ")}` : "";
    await enviar(B, chatId, `✅ Pronto! Baixe o PDF a partir do PowerPoint e envie ao cliente.${pend}${vobiMsg}`);
  } else if (vobiMsg) {
    await enviar(B, chatId, vobiMsg.trim());
  }

  await salvarSessao(db, { ...sessao, estado: "pronto", dados: dadosFinais });
}
