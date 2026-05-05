import type { APIRoute } from "astro";
import { requireAdmin, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    await requireAdmin(request);
    const { data } = await supabaseAdmin()
      .from("manut_clientes")
      .select("id,nome,email,codigo,status,plano_selecionado,valor_mensal_contratado,visitas_contratadas,data_contratacao,data_proximo_vencimento,telefone")
      .order("data_contratacao", { ascending: false })
      .limit(500);
    return jsonOk(data || []);
  } catch (e: any) {
    return jsonErr(401, e.message);
  }
};
