// ============================================================================
// Motor do "EM DESLIGAMENTO": ao iniciar, corta AUTOMATICAMENTE o que o portal
// controla (PortalCJR + Telegram) e gera TAREFAS para a TI cancelar o resto
// (bancos, Vobi, Rotaexata, ControlID e demais plataformas — sem API de escrita).
// O histórico de acessos (rh_acessos) é preservado: marca revogado, não apaga.
// ============================================================================
import { invalidarSessoesPortal } from "./auth";
import { registrarAcao } from "./auditoria";
import { enviarEmailSimples } from "./mailer";
import { enviarTelegram, escTg } from "./telegram";

const RH_EMAIL = import.meta.env.RH_ALERT_EMAIL || "rh@costajr.com.br, adriana@costajr.com.br";
const SITE = (import.meta.env.SITE_BASE_URL || "https://www.costajr.com.br").replace(/\/$/, "");
function env(n: string) { return (import.meta.env as any)[n] || (process.env as any)[n] || ""; }

// Links externos (best-effort) para facilitar a tarefa da TI.
const LINK_SISTEMA: Record<string, string> = {
  Vobi: "https://app.vobi.com.br/",
  Rotaexata: "https://app.rotaexata.com.br/",
  ControlID: "https://www.controlid.com.br/",
};

function botTokenModo(modo: string): string {
  if (modo === "junia") return env("TELEGRAM_BOT_TOKEN_JUNIA") || env("TELEGRAM_BOT_TOKEN");
  if (modo === "adm") return env("TELEGRAM_BOT_TOKEN_ADM") || env("TELEGRAM_BOT_TOKEN");
  return env("TELEGRAM_BOT_TOKEN");
}
async function banChat(token: string, chatId: any, userId: any): Promise<boolean> {
  if (!token || !chatId || !userId) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/banChatMember`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, user_id: Number(userId) }),
    });
    const j: any = await r.json().catch(() => ({}));
    return !!j?.ok;
  } catch { return false; }
}

export type DesligResumo = { portal: string; telegram: string; acessosRevogados: number; tarefas: number };

export async function iniciarDesligamento(db: any, colaboradorId: string, admin: { email: string }, req?: Request): Promise<DesligResumo> {
  const hoje = new Date().toISOString().slice(0, 10);
  const { data: colab } = await db.from("rh_colaboradores").select("id, nome, profile_id, status").eq("id", colaboradorId).maybeSingle();
  if (!colab) throw new Error("Colaborador não encontrado");
  if (colab.status === "desligado") throw new Error("Colaborador já está desligado.");

  // ── 1) PortalCJR — bloqueia login + derruba sessões ───────────────────────
  let portal = "sem login vinculado ao portal";
  if (colab.profile_id) {
    await db.from("portal_profiles").update({ approval_status: "rejected" }).eq("id", colab.profile_id);
    await db.from("portal_sessoes").delete().eq("user_id", colab.profile_id);
    try { await invalidarSessoesPortal(colab.profile_id); } catch { /* best-effort */ }
    portal = "login bloqueado + sessões derrubadas";
  }

  // ── 2) Telegram — remove dos grupos registrados + apaga sessões dos bots ───
  let telegram = "sem sessão de Telegram";
  try {
    const { data: sess } = await db.from("telegram_sessoes").select("telegram_user_id, dados");
    const todas = sess || [];
    const minhas = todas.filter((s: any) => s?.dados?.colaborador_id === colaboradorId);
    const grupos = ["grupo_rh", "grupo_base"].map((k) => todas.find((s: any) => s.telegram_user_id === k)).filter(Boolean);
    const userIds = [...new Set(minhas.map((s: any) => String(s.telegram_user_id).replace(/^(adm:|junia:)/, "")))];
    let bans = 0;
    for (const uid of userIds) {
      for (const g of grupos as any[]) {
        const token = botTokenModo(g.dados?.bot_modo || "adm");
        if (await banChat(token, g.dados?.chat_id, uid)) bans++;
      }
    }
    if (minhas.length) {
      await db.from("telegram_sessoes").delete().in("telegram_user_id", minhas.map((s: any) => s.telegram_user_id));
      telegram = `${userIds.length} conta(s) cortada(s) dos bots${bans ? ` + removida(s) de ${bans} grupo(s)` : ""}`;
    }
  } catch { telegram = "falha ao revogar Telegram (conferir manualmente)"; }

  // ── 3) Acessos ativos → tarefas para a TI + marca revogado (histórico) ─────
  const { data: acessos } = await db.from("rh_acessos").select("id, sistema, categoria, usuario").eq("colaborador_id", colaboradorId).eq("status", "ativo");
  const ativos = acessos || [];
  const tarefas: any[] = [];
  for (const a of ativos) {
    if (a.sistema === "PortalCJR") continue; // já cortado automaticamente
    const cat = a.categoria || "";
    let acao = "cancelar_trocar";
    let desc = `Cancelar ou trocar a senha em ${a.sistema}`;
    if (cat === "Bancos") { acao = "cancelar"; desc = `Cancelar a conta/acesso no banco ${a.sistema}`; }
    else if (a.sistema === "Vobi") { acao = "inativar"; desc = "Inativar o colaborador na Vobi (isActive = false)"; }
    else if (a.sistema === "Rotaexata") { acao = "excluir"; desc = "Excluir o usuário no Rotaexata"; }
    else if (a.sistema === "ControlID") { acao = "excluir"; desc = "Excluir o usuário no ControlID"; }
    tarefas.push({
      colaborador_id: colaboradorId, colaborador_nome: colab.nome, categoria: cat || null,
      sistema: a.sistema, acao, descricao: desc + (a.usuario ? ` — login: ${a.usuario}` : ""),
      link: LINK_SISTEMA[a.sistema] || null, status: "pendente", criado_por: admin.email,
    });
  }
  if (tarefas.length) await db.from("rh_desligamento_tarefas").insert(tarefas);
  if (ativos.length) {
    await db.from("rh_acessos").update({ status: "revogado", revogado_em: hoje, updated_at: new Date().toISOString() })
      .eq("colaborador_id", colaboradorId).eq("status", "ativo");
  }

  // ── 4) status → em_desligamento ────────────────────────────────────────────
  await db.from("rh_colaboradores").update({ status: "em_desligamento", updated_at: new Date().toISOString() }).eq("id", colaboradorId);

  // ── 5) auditoria + avisos (Telegram ADM + e-mail TI) ───────────────────────
  await registrarAcao(db, { req, admin }, {
    acao: "editar", entidade: "rh_colaboradores", registro_id: colaboradorId,
    descricao: `Iniciou desligamento de "${colab.nome}" — Portal/Telegram cortados (${ativos.length} acesso(s)) + ${tarefas.length} tarefa(s) p/ TI`,
    dados: { tarefas: tarefas.length, acessos: ativos.length },
  }).catch(() => {});

  enviarTelegram(`🚪 <b>Desligamento INICIADO</b>\n${escTg(colab.nome)}\nPortalCJR e Telegram cortados automaticamente. <b>${tarefas.length}</b> tarefa(s) p/ a TI cancelar.\nPor ${escTg(admin.email)}`, { canal: "ADM" }).catch(() => {});

  try {
    const linhas = tarefas.map((t) => `<li><b>${t.sistema}</b> — ${t.descricao}${t.link ? ` · <a href="${t.link}">abrir</a>` : ""}</li>`).join("");
    const html = `<div style="font-family:Arial,sans-serif;color:#2D2F36;max-width:640px">
      <h2 style="color:#C41E3A;margin-bottom:4px">🚪 Desligamento iniciado — ${colab.nome}</h2>
      <p style="color:#5B5F6B"><b>PortalCJR</b> e <b>Telegram</b> já foram cortados automaticamente. Providencie os cancelamentos abaixo e marque como feito no RH:</p>
      <ul style="font-size:14px;line-height:1.8">${linhas || "<li>Nenhum acesso externo cadastrado.</li>"}</ul>
      <p style="margin-top:16px"><a href="${SITE}/admin/rh" style="background:#C41E3A;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:700">Abrir o RH</a></p>
      <p style="color:#9CA3AF;font-size:12px;margin-top:24px">Aviso automático — Costa Júnior Engenharia.</p>
    </div>`;
    for (const to of String(RH_EMAIL).split(",").map((s) => s.trim()).filter(Boolean)) {
      await enviarEmailSimples({ to, subject: `🚪 Desligamento iniciado: ${colab.nome} — cancelar acessos`, html }).catch(() => {});
    }
  } catch { /* e-mail nunca derruba o fluxo */ }

  return { portal, telegram, acessosRevogados: ativos.length, tarefas: tarefas.length };
}
