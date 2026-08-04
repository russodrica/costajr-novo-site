import type { APIRoute } from "astro";
import { processarUpdate } from "../../../lib/telegramBot";

export const prerender = false;

// POST /api/telegram/webhook-comercial — recebedor do bot Comercial dedicado
// (@cjrcomercial_bot). Separado do JunIA/Processos de propósito (decisão da
// Adriana, 2026-08-04): regras de negócio próprias no fluxo de proposta
// (mobilização mínima 10 dias, remuneração em 3 percentuais, valor de ganho
// gravado na Vobi, comando "/etapa" — pode mudar de etapa). Mesmo segredo no
// header (INTEGRA_TELEGRAM_SECRET). Roteia em modo "comercial".
const SECRET = import.meta.env.INTEGRA_TELEGRAM_SECRET || process.env.INTEGRA_TELEGRAM_SECRET || "";

export const POST: APIRoute = async ({ request }) => {
  if (SECRET) {
    const h = request.headers.get("x-telegram-bot-api-secret-token") || "";
    if (h !== SECRET) return new Response("forbidden", { status: 403 });
  }
  let update: any = null;
  try { update = await request.json(); } catch { update = null; }
  if (update) { try { await processarUpdate(update, "comercial"); } catch { /* nunca derruba */ } }
  return new Response("ok", { status: 200 });
};
