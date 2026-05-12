import type { APIRoute } from "astro";
import { requireTecnico, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";
import { listarLojaIdsDoTecnico } from "~/lib/manut/tecnicos";

export const prerender = false;

// PATCH /api/manut/tecnico/estoque/itens/[id]
// Body: { preco_unitario?, quantidade_minima?, motivo? }
// - Quantidade mínima: aplicada direto.
// - Preço unitário: gera pedido de aprovação para o admin (não aplica imediato).
export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    const claims = await requireTecnico(request);
    const id = params.id!;
    const body = await request.json();

    const db = supabaseAdmin();
    const { data: item } = await db
      .from("manut_estoque")
      .select("id,loja_id,nome,preco_unitario,quantidade_minima")
      .eq("id", id)
      .single();
    if (!item) return jsonErr(404, "Item não encontrado");

    const lojas = await listarLojaIdsDoTecnico(claims.sub);
    if (!lojas.includes(item.loja_id)) return jsonErr(403, "Item fora das suas lojas");

    // Quantidade mínima: aplicação direta
    const updates: any = { updated_at: new Date().toISOString() };
    if ("quantidade_minima" in body) {
      const n = Number(body.quantidade_minima);
      if (!isFinite(n) || n < 0) return jsonErr(400, "Quantidade mínima inválida");
      updates.quantidade_minima = n;
    }

    // Preço unitário: pedido de aprovação (não aplica direto)
    let pedidoCriado = null;
    if ("preco_unitario" in body) {
      const p = body.preco_unitario;
      let novoPreco: number | null = null;
      if (p === null || p === "" || p === undefined) novoPreco = null;
      else {
        const n = Number(p);
        if (!isFinite(n) || n < 0) return jsonErr(400, "Valor inválido");
        novoPreco = n;
      }

      // Cancela pedidos pendentes prévios desse item desse técnico
      await db
        .from("manut_estoque_alteracoes")
        .update({ status: "rejeitada", resposta_admin: "Substituído por novo pedido", decidido_em: new Date().toISOString() })
        .eq("estoque_id", id)
        .eq("tecnico_id", claims.sub)
        .eq("status", "pendente");

      const { data: pedido, error: pErr } = await db
        .from("manut_estoque_alteracoes")
        .insert({
          estoque_id: id,
          tecnico_id: claims.sub,
          preco_anterior: item.preco_unitario,
          preco_novo: novoPreco,
          qtd_minima_anterior: item.quantidade_minima,
          qtd_minima_nova: updates.quantidade_minima ?? item.quantidade_minima,
          status: "pendente",
          motivo: body.motivo || null,
        })
        .select("*")
        .single();
      if (pErr) return jsonErr(400, pErr.message);
      pedidoCriado = pedido;
    }

    // Aplica updates de quantidade mínima (se houver)
    if (Object.keys(updates).length > 1) {
      const { data, error } = await db
        .from("manut_estoque")
        .update(updates)
        .eq("id", id)
        .select("*")
        .single();
      if (error) return jsonErr(400, error.message);
      return jsonOk({ item: data, alteracaoPendente: pedidoCriado });
    }

    return jsonOk({ item, alteracaoPendente: pedidoCriado });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" || e.message === "Token inválido" ? 401 : 500, e.message);
  }
};
