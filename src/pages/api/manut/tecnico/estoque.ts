import type { APIRoute } from "astro";
import { requireTecnico, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";
import { listarLojaIdsDoTecnico } from "~/lib/manut/tecnicos";
import { listarEstoqueDeLojas, listarMovimentosDeLojas, darBaixaItem, adicionarItemEAplicarBaixa } from "~/lib/manut/estoque";

export const prerender = false;

// GET — lista estoque + movimentos de todas as lojas que o técnico atende
export const GET: APIRoute = async ({ request }) => {
  try {
    const claims = await requireTecnico(request);
    const lojaIds = await listarLojaIdsDoTecnico(claims.sub);
    if (!lojaIds.length) return jsonOk({ itens: [], movimentos: [], lojas: [] });

    const { data: lojas } = await supabaseAdmin()
      .from("manut_lojas")
      .select("id,nome,cidade,uf,manut_clientes(nome)")
      .in("id", lojaIds)
      .order("nome");

    const [itens, movimentos] = await Promise.all([
      listarEstoqueDeLojas(lojaIds),
      listarMovimentosDeLojas(lojaIds),
    ]);
    return jsonOk({ itens, movimentos, lojas: lojas || [] });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" || e.message === "Token inválido" ? 401 : 500, e.message);
  }
};

// POST — baixa em item OU adição de item novo (uso avulso, sem preventiva)
export const POST: APIRoute = async ({ request }) => {
  try {
    const claims = await requireTecnico(request);
    const lojaIds = await listarLojaIdsDoTecnico(claims.sub);
    const body = await request.json();

    if (body.action === "baixa") {
      const { estoque_id, quantidade, observacao } = body;
      if (!estoque_id || !quantidade || Number(quantidade) <= 0) {
        return jsonErr(400, "estoque_id e quantidade obrigatórios");
      }
      // Confere que o item pertence a uma loja do técnico
      const { data: item } = await supabaseAdmin()
        .from("manut_estoque")
        .select("loja_id")
        .eq("id", estoque_id)
        .single();
      if (!item || !lojaIds.includes(item.loja_id)) return jsonErr(403, "Item fora das suas lojas");

      const result = await darBaixaItem({
        estoqueId: estoque_id,
        preventivaId: null,
        tecnicoId: claims.sub,
        quantidade: Number(quantidade),
        observacao,
      });
      return jsonOk(result);
    }

    if (body.action === "novo_item") {
      const { loja_id, nome, unidade, quantidade_usada, observacao } = body;
      if (!loja_id || !nome?.trim() || !quantidade_usada || Number(quantidade_usada) <= 0) {
        return jsonErr(400, "loja_id, nome e quantidade_usada obrigatórios");
      }
      if (!lojaIds.includes(loja_id)) return jsonErr(403, "Loja fora das suas atribuições");

      const result = await adicionarItemEAplicarBaixa({
        lojaId: loja_id,
        nome,
        unidade,
        quantidadeUsada: Number(quantidade_usada),
        preventivaId: null,
        tecnicoId: claims.sub,
        observacao,
      });
      return jsonOk(result);
    }

    return jsonErr(400, "action inválida (use 'baixa' ou 'novo_item')");
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" || e.message === "Token inválido" ? 401 : 500, e.message);
  }
};
