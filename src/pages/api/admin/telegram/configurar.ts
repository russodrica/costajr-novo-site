import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../lib/auth";

export const prerender = false;

// Registra/consulta os webhooks dos bots inbound do Telegram.
// O token NUNCA sai do servidor — o admin só dispara a configuração.
//  • Ativos (@cjr_ativo_bot) = TELEGRAM_BOT_TOKEN     → /api/telegram/webhook
//  • RH     (@cjr_adm_bot)   = TELEGRAM_BOT_TOKEN_ADM → /api/telegram/webhook-adm
function env(n: string) { return (import.meta.env as any)[n] || (process.env as any)[n] || ""; }
const TOKEN_ATIVO = env("TELEGRAM_BOT_TOKEN");
const TOKEN_ADM = env("TELEGRAM_BOT_TOKEN_ADM");
const TOKEN_JUNIA = env("TELEGRAM_BOT_TOKEN_JUNIA");
const SECRET = env("INTEGRA_TELEGRAM_SECRET");
// Telegram NÃO segue redirecionamento: o apex (costajr.com.br) faz 307 -> www, o que
// quebra a entrega dos updates. Forçamos o host www (que responde direto, sem redirect).
let SITE = (env("SITE_BASE_URL") || "https://www.costajr.com.br").replace(/\/$/, "");
if (/^https?:\/\/costajr\.com\.br$/i.test(SITE)) SITE = "https://www.costajr.com.br";

const BOTS = [
  { nome: "Ativos (@cjr_ativo_bot)", token: TOKEN_ATIVO, path: "/api/telegram/webhook" },
  { nome: "RH (@cjr_adm_bot)", token: TOKEN_ADM, path: "/api/telegram/webhook-adm" },
  { nome: "JunIA (@CjrJunIA_bot)", token: TOKEN_JUNIA, path: "/api/telegram/webhook-junia" },
];

// POST → setWebhook nos dois bots configurados
export const POST: APIRoute = async ({ request }) => {
  try {
    await requireAdminCookie(request);
    if (!TOKEN_ATIVO) return jsonErr(503, "TELEGRAM_BOT_TOKEN não configurado na Vercel.");
    if (!SECRET) return jsonErr(503, "INTEGRA_TELEGRAM_SECRET não configurado na Vercel.");
    const resultados: any[] = [];
    for (const b of BOTS) {
      if (!b.token) { resultados.push({ bot: b.nome, ok: false, motivo: "token ausente (não configurado)" }); continue; }
      const url = `${SITE}${b.path}`;
      const r = await fetch(`https://api.telegram.org/bot${b.token}/setWebhook`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, secret_token: SECRET, allowed_updates: ["message", "callback_query"], drop_pending_updates: true }),
      });
      const d = await r.json().catch(() => ({}));
      resultados.push({ bot: b.nome, ok: !!d?.ok, url, telegram: d });
    }
    return jsonOk({ resultados });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// GET → getWebhookInfo dos dois bots
export const GET: APIRoute = async ({ request }) => {
  try {
    await requireAdminCookie(request);
    if (!TOKEN_ATIVO) return jsonErr(503, "TELEGRAM_BOT_TOKEN não configurado na Vercel.");
    const infos: any[] = [];
    for (const b of BOTS) {
      if (!b.token) { infos.push({ bot: b.nome, configurado: false }); continue; }
      const r = await fetch(`https://api.telegram.org/bot${b.token}/getWebhookInfo`);
      const d = await r.json().catch(() => ({}));
      // getMe → confirma QUAL bot é esse token (username), p/ pegar token trocado
      const rm = await fetch(`https://api.telegram.org/bot${b.token}/getMe`);
      const dm = await rm.json().catch(() => ({}));
      const username = dm?.result?.username ? "@" + dm.result.username : (dm?.ok === false ? "token inválido" : "?");
      infos.push({ bot: b.nome, configurado: true, username, info: d?.result || d });
    }
    return jsonOk({ infos });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
