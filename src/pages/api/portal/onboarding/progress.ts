import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { requireAdmin, jsonOk, jsonErr } from "~/lib/auth";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    const claims = await requireAdmin(request);
    const sb = supabaseAdmin();
    const { data } = await sb
      .from("portal_onboarding_progress")
      .select("step_id, concluido, concluido_em")
      .eq("user_id", claims.sub);
    return jsonOk(data || []);
  } catch {
    return jsonErr(401, "Não autenticado.");
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const claims = await requireAdmin(request);
    const { step_id, concluido } = await request.json();
    if (!step_id) return jsonErr(400, "step_id obrigatório.");
    const sb = supabaseAdmin();
    await sb.from("portal_onboarding_progress").upsert({
      user_id: claims.sub,
      step_id,
      concluido,
      concluido_em: concluido ? new Date().toISOString() : null,
    }, { onConflict: "user_id,step_id" });
    return jsonOk({ ok: true });
  } catch {
    return jsonErr(401, "Não autenticado.");
  }
};
