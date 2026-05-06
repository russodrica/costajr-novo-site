import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { requireAdmin, jsonOk, jsonErr } from "~/lib/auth";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    const claims = await requireAdmin(request);
    const sb = supabaseAdmin();
    const { data } = await sb
      .from("portal_announcements")
      .select("*")
      .or(`target_role.eq.all,target_role.eq.${claims.role}`)
      .order("created_at", { ascending: false })
      .limit(20);
    return jsonOk(data || []);
  } catch {
    return jsonErr(401, "Não autenticado.");
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const claims = await requireAdmin(request);
    if (!["admin", "coordenador", "rh"].includes(claims.role)) return jsonErr(403, "Sem permissão.");
    const body = await request.json();
    const { title, content, category, target_role } = body;
    if (!title || !content) return jsonErr(400, "Título e conteúdo são obrigatórios.");
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("portal_announcements")
      .insert({ title, content, category: category || "comunicado", target_role: target_role || "all", created_by: claims.sub })
      .select()
      .single();
    if (error) return jsonErr(500, "Erro ao criar comunicado.");
    return jsonOk(data, 201);
  } catch {
    return jsonErr(401, "Não autenticado.");
  }
};
