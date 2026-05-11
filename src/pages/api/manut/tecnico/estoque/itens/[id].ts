import type { APIRoute } from "astro";
import { requireTecnico, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";
import { listarLojaIdsDoTecnico } from "~/lib/manut/tecnicos";

export const prerender = false;

// PATCH /api/manut/tecnico/estoque/itens/[id]
// Body: { preco_unitario?: number | null, quantidade_minima?: number }
// Atualiza campos editáveis de um item — técnico precisa cobrir a loja do item.
export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    const claims = await requireTecnico(request);
    const id = params.id!;
    const body = await request.json();

    const db = supabaseAdmin();
    const { data: item } = await db
      .from("manut_estoque")
      .select("id,loja_id")
      .eq("id", id)
      .single();
    if (!item) return jsonErr(404, "Item não encontrado");

    const lojas = await listarLojaIdsDoTecnico(claims.sub);
    if (!lojas.includes(item.loja_id)) return jsonErr(403, "Item fora das suas lojas");

    const updates: any = { updated_at: new Date().toISOString() };
    if ("preco_unitario" in body) {
      const p = body.preco_unitario;
      if (p === null || p === "" || p === undefined) {
        updates.preco_unitario = null;
      } else {
        const n = Number(p);
        if (!isFinite(n) || n < 0) return jsonErr(400, "Valor inválido");
        updates.preco_unitario = n;
      }
    }
    if ("quantidade_minima" in body) {
      const n = Number(body.quantidade_minima);
      if (!isFinite(n) || n < 0) return jsonErr(400, "Quantidade mínima inválida");
      updates.quantidade_minima = n;
    }
    if (Object.keys(updates).length <= 1) return jsonErr(400, "Nada a atualizar");

    const { data, error } = await db
      .from("manut_estoque")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();
    if (error) return jsonErr(400, error.message);
    return jsonOk(data);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" || e.message === "Token inválido" ? 401 : 500, e.message);
  }
};
