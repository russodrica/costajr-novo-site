import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { requireAdminCookie, jsonOk, jsonErr } from "~/lib/auth";

export const prerender = false;

export const PUT: APIRoute = async ({ request, params }) => {
  try {
    await requireAdminCookie(request);
    const body = await request.json();
    const sb = supabaseAdmin();
    const { data, error } = await sb.from("portal_announcements").update(body).eq("id", params.id!).select().single();
    if (error) return jsonErr(500, "Erro ao atualizar.");
    return jsonOk(data);
  } catch { return jsonErr(401, "Não autenticado."); }
};

export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    await requireAdminCookie(request);
    const sb = supabaseAdmin();
    await sb.from("portal_announcements").delete().eq("id", params.id!);
    return jsonOk({ ok: true });
  } catch { return jsonErr(401, "Não autenticado."); }
};
