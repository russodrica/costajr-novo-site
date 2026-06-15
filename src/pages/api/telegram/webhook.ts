import type { APIRoute } from "astro";
import { processarUpdate } from "../../../lib/telegramBot";

export const prerender = false;

// POST /api/telegram/webhook  — recebedor dos updates do bot de Ativos.
// Protegido pelo secret que o Telegram devolve no header (definido no setWebhook).
const SECRET = import.meta.env.INTEGRA_TELEGRAM_SECRET || process.env.INTEGRA_TELEGRAM_SECRET || "";

export const POST: APIRoute = async ({ request }) => {
  if (SECRET) {
    const h = request.headers.get("x-telegram-bot-api-secret-token") || "";
    if (h !== SECRET) return new Response("forbidden", { status: 403 });
  }
  let update: any = null;
  try { update = await request.json(); } catch { update = null; }
  // Responde 200 sempre (e processa); o Telegram reenvia se não receber 200.
  if (update) { try { await processarUpdate(update); } catch { /* nunca derruba */ } }
  return new Response("ok", { status: 200 });
};
