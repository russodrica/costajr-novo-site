import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { requireAdmin, jsonOk, jsonErr } from "~/lib/auth";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    const claims = await requireAdmin(request);
    const sb = supabaseAdmin();
    const { data: profile } = await sb
      .from("portal_profiles")
      .select("id, email, display_name, full_name, role, approval_status, last_login_at, created_at")
      .eq("id", claims.sub)
      .single();

    if (!profile) return jsonErr(404, "Perfil não encontrado.");
    return jsonOk(profile);
  } catch {
    return jsonErr(401, "Não autenticado.");
  }
};
