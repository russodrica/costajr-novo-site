import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { requireAdmin, jsonOk, jsonErr } from "~/lib/auth";
import { filtroAcessoConteudo } from "~/lib/permissoes";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    const claims = await requireAdmin(request);
    const sb = supabaseAdmin();
    let q = sb.from("portal_integration_pdfs").select("*").eq("publicado", true);
    const filtro = await filtroAcessoConteudo(claims); // null = admin vê tudo
    if (filtro) q = q.or(filtro);
    const { data } = await q.order("ordem").order("created_at", { ascending: false });
    return jsonOk(data || []);
  } catch {
    return jsonErr(401, "Não autenticado.");
  }
};
