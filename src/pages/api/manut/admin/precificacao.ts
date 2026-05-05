import type { APIRoute } from "astro";
import { requireAdmin, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    await requireAdmin(request);
    const { data, error } = await supabaseAdmin()
      .from("manut_precificacao")
      .select("*")
      .order("ordem");
    if (error) throw new Error(error.message);
    return jsonOk(data || []);
  } catch (e: any) {
    return jsonErr(e.message === "Não autorizado" ? 401 : 500, e.message);
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    await requireAdmin(request);
    const body = await request.json();
    const { tipo_loja, preco_base, custo_especialidade } = body;
    if (!tipo_loja) return jsonErr(400, "tipo_loja obrigatório");

    const { error } = await supabaseAdmin()
      .from("manut_precificacao")
      .update({
        preco_base: Number(preco_base),
        custo_especialidade: Number(custo_especialidade),
        updated_at: new Date().toISOString(),
      })
      .eq("tipo_loja", tipo_loja);
    if (error) throw new Error(error.message);
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autorizado" ? 401 : 500, e.message);
  }
};
