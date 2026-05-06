import type { APIRoute } from "astro";
import { requireCliente, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    const claims = await requireCliente(request);
    const { data, error } = await supabaseAdmin()
      .from("manut_orcamentos")
      .select("*, manut_lojas(nome)")
      .eq("cliente_id", claims.sub)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return jsonOk(data || []);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" || e.message === "Token inválido" ? 401 : 500, e.message);
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const claims = await requireCliente(request);
    const body = await request.json();
    const { loja_id, descricao_solicitacao } = body;
    if (!loja_id || !descricao_solicitacao?.trim()) throw new Error("Loja e descrição são obrigatórios");

    // Verify loja belongs to this client
    const { data: loja } = await supabaseAdmin()
      .from("manut_lojas")
      .select("id")
      .eq("id", loja_id)
      .eq("cliente_id", claims.sub)
      .maybeSingle();
    if (!loja) throw new Error("Loja não encontrada");

    const { data, error } = await supabaseAdmin()
      .from("manut_orcamentos")
      .insert({
        cliente_id: claims.sub,
        loja_id,
        descricao_solicitacao: descricao_solicitacao.trim(),
        status: "aguardando_proposta",
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return jsonOk(data, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" || e.message === "Token inválido" ? 401 : 400, e.message);
  }
};

export const PUT: APIRoute = async ({ request }) => {
  try {
    const claims = await requireCliente(request);
    const body = await request.json();
    const { id, acao, comentario_cliente } = body;
    if (!id || !["aprovar","rejeitar"].includes(acao)) throw new Error("Dados inválidos");

    const { data: orc } = await supabaseAdmin()
      .from("manut_orcamentos")
      .select("id,status")
      .eq("id", id)
      .eq("cliente_id", claims.sub)
      .maybeSingle();
    if (!orc) throw new Error("Orçamento não encontrado");
    if (orc.status !== "proposta_enviada") throw new Error("Orçamento não está disponível para resposta");

    const { data, error } = await supabaseAdmin()
      .from("manut_orcamentos")
      .update({ status: acao === "aprovar" ? "aprovado" : "rejeitado", comentario_cliente: comentario_cliente || null })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return jsonOk(data);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" || e.message === "Token inválido" ? 401 : 400, e.message);
  }
};
