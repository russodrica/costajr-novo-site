import type { APIRoute } from "astro";
import { requireCliente, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    const claims = await requireCliente(request);
    const { data, error } = await supabaseAdmin()
      .from("manut_materiais")
      .select("*, manut_lojas(nome), manut_tecnicos(nome)")
      .eq("cliente_id", claims.sub)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return jsonOk(data || []);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" || e.message === "Token inválido" ? 401 : 500, e.message);
  }
};

export const PUT: APIRoute = async ({ request }) => {
  try {
    const claims = await requireCliente(request);
    const body = await request.json();
    const { id, acao, comprovante_url } = body;
    if (!id || !["aprovar","rejeitar"].includes(acao)) throw new Error("Dados inválidos");

    const { data: mat } = await supabaseAdmin()
      .from("manut_materiais")
      .select("id,status")
      .eq("id", id)
      .eq("cliente_id", claims.sub)
      .maybeSingle();
    if (!mat) throw new Error("Material não encontrado");
    if (mat.status !== "pendente_aprovacao") throw new Error("Material não está pendente de aprovação");

    const updates: Record<string,any> = { status: acao === "aprovar" ? "aprovado" : "rejeitado" };
    if (acao === "aprovar" && comprovante_url) updates.comprovante_url = comprovante_url;

    const { data, error } = await supabaseAdmin()
      .from("manut_materiais")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return jsonOk(data);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" || e.message === "Token inválido" ? 401 : 400, e.message);
  }
};
