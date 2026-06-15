import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";

export const prerender = false;

// GET /api/admin/rh/desligamentos/posse?colaborador_id=
//   Cruza o que o colaborador tem EM POSSE e ainda NÃO devolveu:
//   - Ativos patrimoniais alocados a ele (status 'alocado')
//   - EPIs/uniformes entregues e ainda ativos (sem data de devolução)
//   Serve para travar o desligamento até a devolução completa.
export const GET: APIRoute = async ({ request, url }) => {
  try {
    await requireAdminCookie(request);
    const db = supabaseAdmin();
    const cid = url.searchParams.get("colaborador_id");
    if (!cid) return jsonErr(400, "colaborador_id é obrigatório.");

    const { data: colab } = await db.from("rh_colaboradores").select("id, nome, profile_id, regime").eq("id", cid).maybeSingle();
    if (!colab) return jsonErr(404, "Colaborador não encontrado");

    // Ativos alocados a este colaborador (casa por id, profile_id ou nome — o
    // módulo de ativos pode ter alocado por qualquer um deles).
    const ids = [colab.id, colab.profile_id].filter(Boolean);
    const { data: ativosAloc } = await db.from("ativos")
      .select("id, descricao, categoria, patrimonio, status, alocado_para_tipo, alocado_para_id, alocado_para_nome")
      .eq("alocado_para_tipo", "colaborador").eq("status", "alocado").limit(2000);
    const nomeLow = (colab.nome || "").toLowerCase();
    const ativos = (ativosAloc || []).filter((a: any) =>
      (a.alocado_para_id && ids.includes(a.alocado_para_id)) ||
      (a.alocado_para_nome && String(a.alocado_para_nome).toLowerCase() === nomeLow)
    ).map((a: any) => ({ tipo: "ativo", id: a.id, nome: a.descricao || a.patrimonio || a.id, categoria: a.categoria }));

    // EPIs/uniformes entregues e ainda não devolvidos
    const { data: epis } = await db.from("epi_entregas")
      .select("id, epi, ca, data_devolucao, status").eq("colaborador_id", cid).eq("status", "ativo");
    const epiPendentes = (epis || []).filter((e: any) => !e.data_devolucao)
      .map((e: any) => ({ tipo: "epi", id: e.id, nome: e.epi + (e.ca ? ` (CA ${e.ca})` : ""), categoria: "EPI/Uniforme" }));

    // Acessos a sistemas ainda ATIVOS — informativo (TI revoga; NÃO trava o desligamento).
    const { data: acessosRows } = await db.from("rh_acessos")
      .select("sistema, categoria, usuario").eq("colaborador_id", cid).eq("status", "ativo").order("categoria");
    const acessos = (acessosRows || []).map((a: any) => ({ sistema: a.sistema, categoria: a.categoria || "Outros", usuario: a.usuario || null }));

    return jsonOk({ colaborador: { id: colab.id, nome: colab.nome, regime: colab.regime }, itens: [...ativos, ...epiPendentes], acessos });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
