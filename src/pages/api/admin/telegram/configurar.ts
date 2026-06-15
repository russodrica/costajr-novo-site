import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../lib/auth";

export const prerender = false;

// Registra/consulta o webhook do bot de Ativos (@cjr_ativo_bot).
// O token NUNCA sai do servidor — o admin só dispara a configuração.
const TOKEN = import.meta.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "";
const SECRET = import.meta.env.INTEGRA_TELEGRAM_SECRET || process.env.INTEGRA_TELEGRAM_SECRET || "";
const SITE = import.meta.env.SITE_BASE_URL || "https://www.costajr.com.br";

// POST → setWebhook (ativa o caminho de volta do bot)
export const POST: APIRoute = async ({ request }) => {
  try {
    await requireAdminCookie(request);
    if (!TOKEN) return jsonErr(503, "TELEGRAM_BOT_TOKEN não configurado na Vercel.");
    if (!SECRET) return jsonErr(503, "INTEGRA_TELEGRAM_SECRET não configurado na Vercel.");
    const url = `${SITE.replace(/\/$/, "")}/api/telegram/webhook`;
    const r = await fetch(`https://api.telegram.org/bot${TOKEN}/setWebhook`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, secret_token: SECRET, allowed_updates: ["message", "callback_query"], drop_pending_updates: true }),
    });
    const d = await r.json().catch(() => ({}));
    return jsonOk({ ok: !!d?.ok, url, telegram: d });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// GET → getWebhookInfo (status atual)
export const GET: APIRoute = async ({ request }) => {
  try {
    await requireAdminCookie(request);
    if (!TOKEN) return jsonErr(503, "TELEGRAM_BOT_TOKEN não configurado na Vercel.");
    const r = await fetch(`https://api.telegram.org/bot${TOKEN}/getWebhookInfo`);
    const d = await r.json().catch(() => ({}));
    return jsonOk({ info: d?.result || d });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
