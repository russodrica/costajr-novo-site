import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { requireAdmin, jsonOk, jsonErr } from "~/lib/auth";

export const prerender = false;

export const GET: APIRoute = async ({ request, params }) => {
  try {
    await requireAdmin(request);
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("portal_forum_topicos")
      .select("*")
      .eq("id", params.id!)
      .single();
    if (error || !data) return jsonErr(404, "Tópico não encontrado.");
    // Incrementa views
    await sb.from("portal_forum_topicos").update({ views: (data.views || 0) + 1 }).eq("id", params.id!);
    return jsonOk(data);
  } catch {
    return jsonErr(401, "Não autenticado.");
  }
};
