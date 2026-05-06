import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { requireAdminCookie, jsonOk, jsonErr } from "~/lib/auth";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const claims = await requireAdminCookie(request);
    const { title, content, category, target_role } = await request.json();
    if (!title || !content) return jsonErr(400, "Campos obrigatórios ausentes.");
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("portal_announcements")
      .insert({ title, content, category: category || "comunicado", target_role: target_role || "all", created_by: claims.sub })
      .select().single();
    if (error) return jsonErr(500, "Erro ao criar comunicado.");
    return jsonOk(data, 201);
  } catch { return jsonErr(401, "Não autenticado."); }
};
