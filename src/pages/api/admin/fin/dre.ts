import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";

export const prerender = false;

// GET /api/admin/fin/dre?inicio=YYYY-MM&fim=YYYY-MM  (fim inclusivo)
// DRE simplificado: receitas e despesas por categoria no período + resultado.
export const GET: APIRoute = async ({ request, url }) => {
  try {
    await requireAdminCookie(request);
    const inicioMes = url.searchParams.get("inicio") || "";
    const fimMes = url.searchParams.get("fim") || inicioMes;
    if (!/^\d{4}-\d{2}$/.test(inicioMes) || !/^\d{4}-\d{2}$/.test(fimMes)) {
      return jsonErr(400, "Informe inicio e fim no formato AAAA-MM.");
    }
    const pInicio = `${inicioMes}-01`;
    const [fa, fm] = fimMes.split("-").map(Number);
    const pFim = fm === 12 ? `${fa + 1}-01-01` : `${fa}-${String(fm + 1).padStart(2, "0")}-01`;

    const db = supabaseAdmin();
    const { data, error } = await db.rpc("fin_dre", { p_inicio: pInicio, p_fim: pFim });
    if (error) return jsonErr(500, error.message);

    const receitas = (data || []).filter((r: any) => r.tipo === "receita").map((r: any) => ({ categoria: r.categoria, total: Number(r.total) || 0 }));
    const despesas = (data || []).filter((r: any) => r.tipo === "despesa").map((r: any) => ({ categoria: r.categoria, total: Number(r.total) || 0 }));
    const totalReceitas = receitas.reduce((s: number, r: any) => s + r.total, 0);
    const totalDespesas = despesas.reduce((s: number, r: any) => s + r.total, 0);

    return jsonOk({
      inicio: inicioMes, fim: fimMes,
      receitas, despesas,
      total_receitas: totalReceitas,
      total_despesas: totalDespesas,
      resultado: totalReceitas - totalDespesas,
    });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
