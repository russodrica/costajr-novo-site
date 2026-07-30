import type { APIRoute } from "astro";
import { processarUpdate } from "../../../lib/telegramBot";

export const prerender = false;

// POST /api/telegram/webhook-processos — recebedor do bot de Processos
// (@cjr_processos_bot). Menu por área (Comercial primeiro; Financeiro e
// Operacional entram depois). Mesmo segredo no header (INTEGRA_TELEGRAM_SECRET).
const SECRET = import.meta.env.INTEGRA_TELEGRAM_SECRET || process.env.INTEGRA_TELEGRAM_SECRET || "";

export const POST: APIRoute = async ({ request }) => {
  if (SECRET) {
    const h = request.headers.get("x-telegram-bot-api-secret-token") || "";
    if (h !== SECRET) return new Response("forbidden", { status: 403 });
  }
  let update: any = null;
  try { update = await request.json(); } catch { update = null; }
  if (update) { try { await processarUpdate(update, "processos"); } catch { /* nunca derruba */ } }
  return new Response("ok", { status: 200 });
};
