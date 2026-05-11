import type { APIRoute } from "astro";
import { requireTecnico, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";
import { listarLojaIdsDoTecnico } from "~/lib/manut/tecnicos";
import { listarEstoqueLoja, darBaixaItem, adicionarItemEAplicarBaixa } from "~/lib/manut/estoque";

export const prerender = false;

async function autorizar(claims: any, preventivaId: string) {
  const db = supabaseAdmin();
  const { data: prev } = await db
    .from("manut_preventivas")
    .select("id,loja_id,tecnico_atribuido_id")
    .eq("id", preventivaId)
    .single();
  if (!prev) throw new Error("Preventiva não encontrada");
  const lojas = await listarLojaIdsDoTecnico(claims.sub);
  if (prev.tecnico_atribuido_id !== claims.sub && !lojas.includes(prev.loja_id)) {
    throw new Error("Sem permissão");
  }
  return prev;
}

// GET — lista o estoque da loja desta preventiva
export const GET: APIRoute = async ({ request, params }) => {
  try {
    const claims = await requireTecnico(request);
    const prev = await autorizar(claims, params.id!);
    const itens = await listarEstoqueLoja(prev.loja_id);
    // Movimentos desta preventiva
    const { data: movs } = await supabaseAdmin()
      .from("manut_estoque_movimentos")
      .select("*, manut_estoque(nome,unidade)")
      .eq("preventiva_id", params.id!)
      .order("created_at", { ascending: false });
    return jsonOk({ itens, movimentos: movs || [] });
  } catch (e: any) {
    return jsonErr(e.message === "Sem permissão" ? 403 : e.message === "Não autenticado" || e.message === "Token inválido" ? 401 : 500, e.message);
  }
};

// POST — baixa de item OU adição de item novo
export const POST: APIRoute = async ({ request, params }) => {
  try {
    const claims = await requireTecnico(request);
    const prev = await autorizar(claims, params.id!);
    const body = await request.json();

    if (body.action === "baixa") {
      const { estoque_id, quantidade, observacao } = body;
      if (!estoque_id || !quantidade || Number(quantidade) <= 0) {
        return jsonErr(400, "estoque_id e quantidade são obrigatórios");
      }
      const result = await darBaixaItem({
        estoqueId: estoque_id,
        preventivaId: params.id!,
        tecnicoId: claims.sub,
        quantidade: Number(quantidade),
        observacao,
      });
      return jsonOk(result);
    }

    if (body.action === "novo_item") {
      const { nome, unidade, quantidade_usada, observacao } = body;
      if (!nome?.trim() || !quantidade_usada || Number(quantidade_usada) <= 0) {
        return jsonErr(400, "nome e quantidade_usada são obrigatórios");
      }
      const result = await adicionarItemEAplicarBaixa({
        lojaId: prev.loja_id,
        nome,
        unidade,
        quantidadeUsada: Number(quantidade_usada),
        preventivaId: params.id!,
        tecnicoId: claims.sub,
        observacao,
      });
      return jsonOk(result);
    }

    return jsonErr(400, "action inválida (use 'baixa' ou 'novo_item')");
  } catch (e: any) {
    return jsonErr(e.message === "Sem permissão" ? 403 : e.message === "Não autenticado" || e.message === "Token inválido" ? 401 : 500, e.message);
  }
};
