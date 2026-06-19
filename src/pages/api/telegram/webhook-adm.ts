import type { APIRoute } from "astro";
import { processarUpdate } from "../../../lib/telegramBot";

export const prerender = false;

// POST /api/telegram/webhook-adm — recebedor dos updates do bot de RH (@cjr_adm_bot).
// Mesmo segredo do header (INTEGRA_TELEGRAM_SECRET). Roteia em modo "adm".
const SECRET = import.meta.env.INTEGRA_TELEGRAM_SECRET || process.env.INTEGRA_TELEGRAM_SECRET || "";

export const POST: APIRoute = async ({ request }) => {
  if (SECRET) {
    const h = request.headers.get("x-telegram-bot-api-secret-token") || "";
    if (h !== SECRET) return new Response("forbidden", { status: 403 });
  }
  let update: any = null;
  try { update = await request.json(); } catch { update = null; }
  if (update) { try { await processarUpdate(update, "adm"); } catch { /* nunca derruba */ } }
  return new Response("ok", { status: 200 });
};
