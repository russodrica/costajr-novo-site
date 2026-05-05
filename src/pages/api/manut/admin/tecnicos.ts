import type { APIRoute } from "astro";
import { requireAdmin, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    await requireAdmin(request);
    const { data } = await supabaseAdmin()
      .from("manut_tecnicos")
      .select("id,nome,email,telefone,especialidades,status,last_login_at,created_at")
      .order("nome");
    return jsonOk(data || []);
  } catch (e: any) {
    return jsonErr(401, e.message);
  }
};
