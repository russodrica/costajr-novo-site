import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { requireAdminCookie, jsonOk, jsonErr } from "~/lib/auth";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const claims = await requireAdminCookie(request);
    const { titulo, url, categoria, descricao, ordem, paginas, publicado, access_roles } = await request.json();
    if (!titulo || !url) return jsonErr(400, "Título e URL são obrigatórios.");
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("portal_treinamentos_pdfs")
      .insert({ titulo, url, categoria: categoria || "geral", descricao, ordem: ordem || 1, paginas: paginas || null, publicado: publicado !== false, access_roles: access_roles?.length ? access_roles : ["all"], created_by: claims.sub })
      .select().single();
    if (error) return jsonErr(500, "Erro ao criar.");
    return jsonOk(data, 201);
  } catch { return jsonErr(401, "Não autenticado."); }
};
