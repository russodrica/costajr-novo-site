// ════════════════════════════════════════════════════════════════════════
// Central de envio de notificações via Telegram (Bot @cjr_ativo_bot).
// Token em TELEGRAM_BOT_TOKEN; destino padrão (grupo) em TELEGRAM_CHAT_ID.
// É best-effort: nunca lança — só retorna { ok }. Não bloqueia a ação que chamou.
// ════════════════════════════════════════════════════════════════════════

function envVar(name: string): string {
  return (import.meta.env as any)[name] || (process.env as any)[name] || "";
}
const TOKEN_PADRAO = envVar("TELEGRAM_BOT_TOKEN");
const CHAT_PADRAO = envVar("TELEGRAM_CHAT_ID");

// UM BOT POR ÁREA/CANAL: cada canal tem seu próprio bot (token) e seu grupo (chat).
//  - "ATIVOS"  -> bot @cjr_ativo_bot, grupo de Ativos   (default = TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID)
//  - "ADM"     -> bot @cjr_adm_bot,   grupo Administrativo (Jurídico/RH/demais)
// Envs por canal: TELEGRAM_BOT_TOKEN_<CANAL> + TELEGRAM_CHAT_<CANAL>. Sem elas, cai no padrão.
function canalConfig(canal?: string): { token: string; chat: string } {
  if (!canal) return { token: TOKEN_PADRAO, chat: CHAT_PADRAO };
  const c = canal.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  return {
    token: envVar("TELEGRAM_BOT_TOKEN_" + c) || TOKEN_PADRAO,
    chat: envVar("TELEGRAM_CHAT_" + c) || CHAT_PADRAO,
  };
}

export function telegramConfigurado(): boolean {
  return !!TOKEN_PADRAO && !!CHAT_PADRAO;
}

type EnvioResp = { ok: boolean; motivo?: string; resposta?: any };

/** Envia mensagem (HTML). opts.canal escolhe o bot+grupo da área ("ATIVOS"|"ADM"...); opts.chatId sobrescreve o destino. */
export async function enviarTelegram(texto: string, opts: { chatId?: string | number; canal?: string; area?: string } = {}): Promise<EnvioResp> {
  const cfg = canalConfig(opts.canal || opts.area);
  const TOKEN = cfg.token;
  if (!TOKEN) return { ok: false, motivo: "token do Telegram ausente" };
  const chat = opts.chatId ?? cfg.chat;
  if (!chat) return { ok: false, motivo: "chat_id do Telegram ausente" };
  try {
    const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: texto, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    const d = await r.json().catch(() => ({}));
    return { ok: !!d?.ok, resposta: d };
  } catch (e: any) {
    return { ok: false, motivo: String(e?.message || e) };
  }
}

/** Escapa caracteres especiais do HTML do Telegram (&, <, >). */
export function escTg(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
