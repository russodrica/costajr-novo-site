import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/supabase";
import { registrarAcessoLink, validarLink } from "../../../lib/itensDeposito";

export const prerender = false;

// POST { t } → registra que o credor leu e aceitou o aviso (data, hora, IP).
export const POST: APIRoute = async ({ request }) => {
  const h = { "content-type": "application/json" };
  try {
    const { t } = await request.json();
    const db = supabaseAdmin();
    const ok = await validarLink(db, String(t || ""));
    if (!ok) return new Response(JSON.stringify({ error: "Link expirado" }), { status: 403, headers: h });
    await registrarAcessoLink(db, ok.links, ok.link, "aceitou", request);
    return new Response(JSON.stringify({ ok: true }), { headers: h });
  } catch {
    return new Response(JSON.stringify({ error: "Pedido inválido" }), { status: 400, headers: h });
  }
};
