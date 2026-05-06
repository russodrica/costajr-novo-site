import type { APIRoute } from "astro";
import { requireAdmin, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    await requireAdmin(request);
    const { data, error } = await supabaseAdmin()
      .from("manut_lojas")
      .select("id, nome, cidade, uf, status, cliente_id, manut_clientes(nome)")
      .order("nome");
    if (error) throw new Error(error.message);
    return jsonOk(data || []);
  } catch (e: any) {
    return jsonErr(e.message === "Não autorizado" ? 401 : 500, e.message);
  }
};
