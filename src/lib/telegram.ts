// ════════════════════════════════════════════════════════════════════════
// Central de envio de notificações via Telegram (Bot @cjr_ativo_bot).
// Token em TELEGRAM_BOT_TOKEN; destino padrão (grupo) em TELEGRAM_CHAT_ID.
// É best-effort: nunca lança — só retorna { ok }. Não bloqueia a ação que chamou.
// ════════════════════════════════════════════════════════════════════════

const TOKEN = import.meta.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "";
const CHAT_PADRAO = import.meta.env.TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID || "";

// Um grupo por ÁREA: cada área tem seu próprio chat_id na env TELEGRAM_CHAT_<AREA>.
// Ex.: TELEGRAM_CHAT_ATIVOS, TELEGRAM_CHAT_RH, TELEGRAM_CHAT_FINANCEIRO...
// Sem a env da área, cai no grupo padrão (TELEGRAM_CHAT_ID = grupo de Ativos hoje).
function chatDaArea(area?: string): string {
  if (!area) return CHAT_PADRAO;
  const key = "TELEGRAM_CHAT_" + area.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  return (import.meta.env as any)[key] || (process.env as any)[key] || CHAT_PADRAO;
}

export function telegramConfigurado(): boolean {
  return !!TOKEN && !!CHAT_PADRAO;
}

type EnvioResp = { ok: boolean; motivo?: string; resposta?: any };

/** Envia mensagem (HTML). opts.area escolhe o grupo da área; opts.chatId sobrescreve tudo. */
export async function enviarTelegram(texto: string, opts: { chatId?: string | number; area?: string } = {}): Promise<EnvioResp> {
  if (!TOKEN) return { ok: false, motivo: "TELEGRAM_BOT_TOKEN ausente" };
  const chat = opts.chatId ?? chatDaArea(opts.area);
  if (!chat) return { ok: false, motivo: "TELEGRAM_CHAT_ID ausente" };
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
