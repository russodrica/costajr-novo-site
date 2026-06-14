import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { EPI_CATALOGO } from "../../../../../lib/epi";

export const prerender = false;

// GET /api/admin/rh/epi?colaborador_id=  → entregas (estado atual) + fichas (histórico)
//     /api/admin/rh/epi                  → itens vencendo em 15 dias (visão geral)
export const GET: APIRoute = async ({ request, url }) => {
  try {
    await requireAdminCookie(request);
    const db = supabaseAdmin();
    const colaboradorId = url.searchParams.get("colaborador_id");

    if (colaboradorId) {
      const [{ data: entregas }, { data: fichas }] = await Promise.all([
        db.from("epi_entregas").select("*").eq("colaborador_id", colaboradorId),
        db.from("epi_fichas").select("id, tipo, data_geracao, status, assinado_path, itens, created_at").eq("colaborador_id", colaboradorId).order("created_at", { ascending: false }).limit(100),
      ]);
      // monta a lista na ordem do catálogo (sempre completa), preenchendo vazios
      const porEpi: Record<string, any> = {};
      for (const e of entregas || []) porEpi[e.epi] = e;
      const lista = EPI_CATALOGO.map((epi) => porEpi[epi] || { epi, ca: null, tamanho: null, data_entrega: null, data_validade: null, data_devolucao: null, status: "ativo" });
      // extras fora do catálogo (se houver)
      for (const e of entregas || []) if (!EPI_CATALOGO.includes(e.epi)) lista.push(e);
      return jsonOk({ catalogo: EPI_CATALOGO, itens: lista, fichas: fichas || [] });
    }

    const limite = new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10);
    const { data } = await db.from("epi_entregas")
      .select("epi, ca, data_validade, colaborador_id, rh_colaboradores(nome)")
      .eq("status", "ativo").not("data_validade", "is", null).lte("data_validade", limite)
      .order("data_validade", { ascending: true }).limit(500);
    const vencendo = (data || []).map((d: any) => { const c: any = d.rh_colaboradores; return { ...d, colaborador: (Array.isArray(c) ? c[0]?.nome : c?.nome) || "—" }; });
    return jsonOk({ vencendo });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
