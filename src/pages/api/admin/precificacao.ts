import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../lib/auth";
import { supabaseAdmin } from "../../../lib/supabase";

export const PATCH: APIRoute = async ({ request }) => {
  try {
    await requireAdminCookie(request);
    const { tipo_loja, ...updates } = await request.json();
    if (!tipo_loja) return jsonErr(400, "tipo_loja obrigatório");
    const db = supabaseAdmin();
    const { data, error } = await db.from("manut_precificacao")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("tipo_loja", tipo_loja).select().single();
    if (error) return jsonErr(400, error.message);
    return jsonOk(data);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
