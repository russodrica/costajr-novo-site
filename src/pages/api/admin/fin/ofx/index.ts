import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";

export const prerender = false;

const TOLERANCIA = 0.01;
const JANELA_DIAS = 5;

function difDias(a: string, b: string): number {
  return Math.abs((new Date(a + "T00:00:00Z").getTime() - new Date(b + "T00:00:00Z").getTime()) / 86400000);
}

// GET /api/admin/fin/ofx?status=pendente|conciliado|ignorado|todos
// Lista o extrato importado; para transações pendentes, sugere até 3 matches
// em fin_lancamentos não conciliados (mesmo |valor| ±0,01 e data ±5 dias).
export const GET: APIRoute = async ({ request, url }) => {
  try {
    await requireAdminCookie(request);
    const db = supabaseAdmin();

    const status = url.searchParams.get("status") || "pendente";
    let q = db.from("fin_extrato_ofx")
      .select("*")
      .order("data", { ascending: false })
      .order("importado_em", { ascending: false })
      .limit(500);
    if (status !== "todos") q = q.eq("status", status);

    const { data: extrato, error } = await q;
    if (error) return jsonErr(500, error.message);

    // contadores para os cards
    const hoje = new Date();
    const mesIni = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-01`;
    const [pend, concMes, ign] = await Promise.all([
      db.from("fin_extrato_ofx").select("id", { count: "exact", head: true }).eq("status", "pendente"),
      db.from("fin_extrato_ofx").select("id", { count: "exact", head: true }).eq("status", "conciliado").gte("data", mesIni),
      db.from("fin_extrato_ofx").select("id", { count: "exact", head: true }).eq("status", "ignorado"),
    ]);
    const contadores = {
      pendentes: pend.count ?? 0,
      conciliadas_mes: concMes.count ?? 0,
      ignoradas: ign.count ?? 0,
    };

    // sugestões de match para as pendentes
    const pendentes = (extrato || []).filter((e: any) => e.status === "pendente");
    let lancs: any[] = [];
    if (pendentes.length) {
      const { data, error: e2 } = await db.from("fin_lancamentos")
        .select("id, descricao, valor, data_vencimento, data_pagamento, tipo, status, fornecedor_cliente")
        .eq("conciliado", false)
        .neq("status", "cancelado")
        .order("data_vencimento", { ascending: false })
        .limit(3000);
      if (e2) return jsonErr(500, e2.message);
      lancs = data || [];
    }

    const resultado = (extrato || []).map((e: any) => {
      let sugestoes: any[] = [];
      if (e.status === "pendente") {
        const alvo = Math.abs(Number(e.valor));
        const tipoEsperado = Number(e.valor) > 0 ? "receita" : "despesa";
        sugestoes = lancs
          .filter((l) => {
            if (Math.abs(Math.abs(Number(l.valor)) - alvo) > TOLERANCIA) return false;
            if (l.tipo !== tipoEsperado) return false;
            const dv = l.data_vencimento && difDias(l.data_vencimento, e.data) <= JANELA_DIAS;
            const dp = l.data_pagamento && difDias(l.data_pagamento, e.data) <= JANELA_DIAS;
            return Boolean(dv || dp);
          })
          .sort((a, b) => {
            const da = Math.min(
              a.data_pagamento ? difDias(a.data_pagamento, e.data) : 99,
              a.data_vencimento ? difDias(a.data_vencimento, e.data) : 99,
            );
            const dbb = Math.min(
              b.data_pagamento ? difDias(b.data_pagamento, e.data) : 99,
              b.data_vencimento ? difDias(b.data_vencimento, e.data) : 99,
            );
            return da - dbb;
          })
          .slice(0, 3)
          .map((l) => ({
            id: l.id,
            descricao: l.descricao,
            valor: l.valor,
            data: l.data_pagamento || l.data_vencimento,
            tipo: l.tipo,
            status: l.status,
          }));
      }
      return { ...e, sugestoes };
    });

    return jsonOk({ extrato: resultado, contadores });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
