import type { APIRoute } from "astro";
import { requireAdmin, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    await requireAdmin(request);
    const { data, error } = await supabaseAdmin()
      .from("manut_cupons")
      .select("*")
      .order("created_at", { ascending: false });
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
    const { codigo, descricao, desconto_percentual, duracao_meses, usos_maximos, validade } = body;
    if (!codigo || !desconto_percentual) return jsonErr(400, "codigo e desconto_percentual obrigatórios");

    const { data, error } = await supabaseAdmin()
      .from("manut_cupons")
      .insert({
        codigo: codigo.toUpperCase().trim(),
        descricao,
        desconto_percentual: Number(desconto_percentual),
        duracao_meses: Number(duracao_meses) || 1,
        usos_maximos: usos_maximos ? Number(usos_maximos) : null,
        validade: validade || null,
        ativo: true,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return jsonOk(data);
  } catch (e: any) {
    return jsonErr(e.message === "Não autorizado" ? 401 : 500, e.message);
  }
};
