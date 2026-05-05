import type { APIRoute } from "astro";
import { processarMpWebhook } from "~/lib/manut/mpWebhook";
import { jsonOk } from "~/lib/auth";

export const prerender = false;

async function handle(request: Request, url: URL) {
  let body: any = {};
  try { body = await request.json(); } catch { /* GET ou body vazio */ }
  const tipo = body.type || body.topic || url.searchParams.get("type") || url.searchParams.get("topic") || undefined;
  const recursoId = (body.data && body.data.id) || body.id || url.searchParams.get("id") || undefined;
  const externalReference = body.external_reference || url.searchParams.get("external_reference") || undefined;
  console.log("[mp][webhook]", { tipo, recursoId, externalReference });
  try {
    const r = await processarMpWebhook({ tipo, recursoId, externalReference });
    return jsonOk(r);
  } catch (e: any) {
    console.error("[mp][webhook] erro", e);
    // Sempre 200 pra MP não reenviar
    return jsonOk({ ok: false, erro: e.message });
  }
}

export const POST: APIRoute = ({ request, url }) => handle(request, url);
export const GET: APIRoute  = ({ request, url }) => handle(request, url);
