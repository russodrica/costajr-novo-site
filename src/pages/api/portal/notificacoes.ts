import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { requireAdmin, jsonOk, jsonErr } from "~/lib/auth";

export const prerender = false;

// GET — últimas notificações + contagem de não lidas
export const GET: APIRoute = async ({ request }) => {
  try {
    const claims = await requireAdmin(request);
    const sb = supabaseAdmin();
    const [{ data }, { count }] = await Promise.all([
      sb.from("portal_notificacoes").select("*").eq("user_id", claims.sub).order("created_at", { ascending: false }).limit(30),
      sb.from("portal_notificacoes").select("*", { count: "exact", head: true }).eq("user_id", claims.sub).eq("lida", false),
    ]);
    return jsonOk({ notificacoes: data || [], nao_lidas: count ?? 0 });
  } catch {
    return jsonErr(401, "Não autenticado.");
  }
};

// PATCH { id } marca uma como lida · { todas: true } marca todas
export const PATCH: APIRoute = async ({ request }) => {
  try {
    const claims = await requireAdmin(request);
    const { id, todas } = await request.json();
    const sb = supabaseAdmin();
    let q = sb.from("portal_notificacoes").update({ lida: true }).eq("user_id", claims.sub);
    if (!todas) {
      if (!id) return jsonErr(400, "Informe a notificação.");
      q = q.eq("id", id);
    }
    const { error } = await q;
    if (error) return jsonErr(400, error.message);
    return jsonOk({ ok: true });
  } catch {
    return jsonErr(401, "Não autenticado.");
  }
};
