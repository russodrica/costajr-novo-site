import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { requireAdmin, jsonOk, jsonErr } from "~/lib/auth";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    const claims = await requireAdmin(request);
    const sb = supabaseAdmin();
    const { data } = await sb
      .from("portal_kb")
      .select("id, question, answer, category")
      .or(`access_roles.cs.{all},access_roles.cs.{${claims.role}}`)
      .order("category")
      .order("created_at");
    return jsonOk(data || []);
  } catch {
    return jsonErr(401, "Não autenticado.");
  }
};
