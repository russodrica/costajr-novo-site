import type { APIRoute } from "astro";
import { requireAdmin, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    await requireAdmin(request);
    const { data, error } = await supabaseAdmin()
      .from("manut_leads")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
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
    const { nome, nome_loja, email, telefone, plano, valor, etapa, observacoes } = body;
    if (!nome || !email) return jsonErr(400, "nome e email obrigatórios");

    const { data, error } = await supabaseAdmin()
      .from("manut_leads")
      .insert({ nome, nome_loja, email: email.toLowerCase(), telefone, plano, valor, etapa: etapa || "novo", observacoes })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return jsonOk(data);
  } catch (e: any) {
    return jsonErr(e.message === "Não autorizado" ? 401 : 500, e.message);
  }
};
