import type { APIRoute } from "astro";
import { requireCliente, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";
import { listarEstoqueCliente, listarMovimentosCliente, criarItemEstoque, solicitarReposicao } from "~/lib/manut/estoque";

export const prerender = false;

// GET — lista todos os itens + movimentos das lojas do cliente
export const GET: APIRoute = async ({ request }) => {
  try {
    const claims = await requireCliente(request);
    const [itens, movimentos] = await Promise.all([
      listarEstoqueCliente(claims.sub),
      listarMovimentosCliente(claims.sub),
    ]);
    // Lojas do cliente (para o seletor)
    const { data: lojas } = await supabaseAdmin()
      .from("manut_lojas")
      .select("id,nome,cidade,uf")
      .eq("cliente_id", claims.sub)
      .order("nome");
    return jsonOk({ itens, movimentos, lojas: lojas || [] });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" || e.message === "Token inválido" ? 401 : 500, e.message);
  }
};

// POST — adicionar novo item ao kit
export const POST: APIRoute = async ({ request }) => {
  try {
    const claims = await requireCliente(request);
    const body = await request.json();
    const { loja_id, nome, unidade, quantidade_atual, quantidade_minima } = body;

    // Confere que a loja pertence ao cliente
    const { data: loja } = await supabaseAdmin()
      .from("manut_lojas")
      .select("id,cliente_id")
      .eq("id", loja_id)
      .single();
    if (!loja || loja.cliente_id !== claims.sub) return jsonErr(403, "Loja não pertence a você");

    const item = await criarItemEstoque({
      lojaId: loja_id,
      nome,
      unidade,
      quantidadeAtual: Number(quantidade_atual) || 0,
      quantidadeMinima: Number(quantidade_minima) || 1,
    });
    return jsonOk(item, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" || e.message === "Token inválido" ? 401 : 400, e.message);
  }
};
