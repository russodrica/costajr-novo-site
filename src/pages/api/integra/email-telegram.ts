import type { APIRoute } from "astro";
import { enviarTelegram, escTg } from "../../../lib/telegram";

export const prerender = false;

// POST /api/integra/email-telegram
// Recebedor para automações (ex.: Power Automate / regra de e-mail): quando chega
// um e-mail numa caixa monitorada, dispara uma mensagem num grupo do Telegram.
// Protegido por segredo (header "x-integra-secret" ou ?key=). Body JSON:
//   { assunto, de, resumo?, caixa?, canal? }   canal default = "ADM"
const SECRET = import.meta.env.INTEGRA_TELEGRAM_SECRET || process.env.INTEGRA_TELEGRAM_SECRET || "";

export const POST: APIRoute = async ({ request, url }) => {
  try {
    if (!SECRET) return new Response(JSON.stringify({ ok: false, error: "INTEGRA_TELEGRAM_SECRET não configurado" }), { status: 503, headers: { "content-type": "application/json" } });
    const chave = request.headers.get("x-integra-secret") || url.searchParams.get("key") || "";
    if (chave !== SECRET) return new Response(JSON.stringify({ ok: false, error: "não autorizado" }), { status: 401, headers: { "content-type": "application/json" } });

    // Lê o corpo de forma tolerante: se o JSON quebrar (ex.: aspas no assunto
    // vindas do Power Automate), usa o texto cru como assunto — nunca falha calado.
    const raw = await request.text().catch(() => "");
    let body: any = {};
    try { body = raw ? JSON.parse(raw) : {}; }
    catch { body = { assunto: raw.replace(/^\{|\}$/g, "").slice(0, 300) }; }
    const assunto = String(body.assunto || body.subject || "(sem assunto)").slice(0, 300);
    const de = String(body.de || body.from || "").slice(0, 200);
    const resumo = String(body.resumo || body.preview || body.body || "").slice(0, 500);
    const caixa = String(body.caixa || body.mailbox || "Jurídico").slice(0, 60);
    const canal = String(body.canal || "ADM").slice(0, 30);

    const msg = `📧 <b>Novo e-mail — ${escTg(caixa)}</b>\n` +
      (de ? `De: ${escTg(de)}\n` : "") +
      `Assunto: <b>${escTg(assunto)}</b>` +
      (resumo ? `\n<i>${escTg(resumo)}</i>` : "");

    const r = await enviarTelegram(msg, { canal });
    return new Response(JSON.stringify({ ok: r.ok, motivo: r.motivo }), { status: r.ok ? 200 : 502, headers: { "content-type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500, headers: { "content-type": "application/json" } });
  }
};
