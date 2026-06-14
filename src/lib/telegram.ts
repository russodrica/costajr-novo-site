// ════════════════════════════════════════════════════════════════════════
// Central de envio de notificações via Telegram (Bot @cjr_ativo_bot).
// Token em TELEGRAM_BOT_TOKEN; destino padrão (grupo) em TELEGRAM_CHAT_ID.
// É best-effort: nunca lança — só retorna { ok }. Não bloqueia a ação que chamou.
// ════════════════════════════════════════════════════════════════════════

const TOKEN = import.meta.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "";
const CHAT_PADRAO = import.meta.env.TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID || "";

export function telegramConfigurado(): boolean {
  return !!TOKEN && !!CHAT_PADRAO;
}

type EnvioResp = { ok: boolean; motivo?: string; resposta?: any };

/** Envia uma mensagem (HTML) ao grupo/chat. Use chatId para sobrescrever o destino. */
export async function enviarTelegram(texto: string, opts: { chatId?: string | number } = {}): Promise<EnvioResp> {
  if (!TOKEN) return { ok: false, motivo: "TELEGRAM_BOT_TOKEN ausente" };
  const chat = opts.chatId ?? CHAT_PADRAO;
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
