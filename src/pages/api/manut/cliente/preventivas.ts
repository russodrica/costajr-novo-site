import type { APIRoute } from "astro";
import { requireCliente, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    const claims = await requireCliente(request);
    const { data, error } = await supabaseAdmin()
      .from("manut_preventivas")
      .select("*, manut_lojas(nome,cidade,uf), manut_tecnicos(nome)")
      .eq("cliente_id", claims.sub)
      .order("data_agendada", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return jsonOk(data || []);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" || e.message === "Token inválido" ? 401 : 500, e.message);
  }
};
