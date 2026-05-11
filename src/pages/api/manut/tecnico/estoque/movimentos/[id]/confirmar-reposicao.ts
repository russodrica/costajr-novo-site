import type { APIRoute } from "astro";
import { requireTecnico, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";
import { listarLojaIdsDoTecnico } from "~/lib/manut/tecnicos";
import { confirmarReposicaoFisica } from "~/lib/manut/estoque";

export const prerender = false;

// POST /api/manut/tecnico/estoque/movimentos/[id]/confirmar-reposicao
// Body: { quantidade?: number }  — se omitido usa a quantidade original do movimento
// Soma na qtd_atual do item e marca como atendida.
export const POST: APIRoute = async ({ request, params }) => {
  try {
    const claims = await requireTecnico(request);
    const movId = params.id!;
    const body = await request.json().catch(() => ({}));

    const db = supabaseAdmin();
    const { data: mov } = await db
      .from("manut_estoque_movimentos")
      .select("loja_id,reposicao_status")
      .eq("id", movId)
      .single();
    if (!mov) return jsonErr(404, "Movimento não encontrado");

    const lojas = await listarLojaIdsDoTecnico(claims.sub);
    if (!lojas.includes(mov.loja_id)) return jsonErr(403, "Loja fora das suas atribuições");

    const result = await confirmarReposicaoFisica({
      movimentoId: movId,
      tecnicoId: claims.sub,
      quantidade: body.quantidade,
    });
    return jsonOk(result);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" || e.message === "Token inválido" ? 401 : 500, e.message);
  }
};
