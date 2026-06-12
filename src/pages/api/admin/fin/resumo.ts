import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";

export const prerender = false;

function chaveMes(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

type ResumoMes = {
  receitas_previstas: number;
  receitas_recebidas: number;
  despesas_previstas: number;
  despesas_pagas: number;
  manut_recebido: number;
};

// GET /api/admin/fin/resumo?meses=6
// Consolida fin_lancamentos + manut_pagamentos (somente leitura) na visão de caixa.
export const GET: APIRoute = async ({ request, url }) => {
  try {
    await requireAdminCookie(request);
    const db = supabaseAdmin();

    const mesesParam = Number(url.searchParams.get("meses")) || 6;
    const meses = Math.min(24, Math.max(1, mesesParam));

    const inicio = new Date();
    inicio.setMonth(inicio.getMonth() - (meses - 1));
    inicio.setDate(1);
    inicio.setHours(0, 0, 0, 0);
    const inicioStr = `${chaveMes(inicio)}-01`;

    const hoje = new Date();
    const hojeStr = `${chaveMes(hoje)}-${String(hoje.getDate()).padStart(2, "0")}`;
    const mesAtual = chaveMes(hoje);

    const [
      { data: lancamentos, error: lancErro },
      { data: abertos, error: abertosErro },
      { data: manutPagos, error: manutErro },
    ] = await Promise.all([
      // lançamentos com vencimento OU pagamento dentro do período
      db.from("fin_lancamentos")
        .select("tipo, valor, status, data_vencimento, data_pagamento")
        .or(`data_vencimento.gte.${inicioStr},data_pagamento.gte.${inicioStr}`)
        .limit(5000),
      // tudo que está em aberto (para atrasados, sem limite de período)
      db.from("fin_lancamentos")
        .select("tipo, valor, status, data_vencimento")
        .in("status", ["previsto", "atrasado"])
        .limit(5000),
      // recebimentos de manutenção pagos no período (consolidação somente leitura)
      db.from("manut_pagamentos")
        .select("valor, data_pagamento")
        .eq("status", "pago")
        .gte("data_pagamento", inicioStr)
        .limit(5000),
    ]);
    if (lancErro) return jsonErr(500, lancErro.message);
    if (abertosErro) return jsonErr(500, abertosErro.message);
    if (manutErro) return jsonErr(500, manutErro.message);

    // ── Agregação por mês (em JS) ──
    const porMes: Record<string, ResumoMes> = {};
    for (let i = 0; i < meses; i++) {
      const d = new Date(inicio);
      d.setMonth(d.getMonth() + i);
      porMes[chaveMes(d)] = { receitas_previstas: 0, receitas_recebidas: 0, despesas_previstas: 0, despesas_pagas: 0, manut_recebido: 0 };
    }

    for (const l of lancamentos || []) {
      const v = Number(l.valor) || 0;
      if (l.status !== "cancelado" && l.data_vencimento) {
        const k = String(l.data_vencimento).slice(0, 7);
        if (k in porMes) {
          if (l.tipo === "receita") porMes[k].receitas_previstas += v;
          else porMes[k].despesas_previstas += v;
        }
      }
      if (l.status === "pago" && l.data_pagamento) {
        const k = String(l.data_pagamento).slice(0, 7);
        if (k in porMes) {
          if (l.tipo === "receita") porMes[k].receitas_recebidas += v;
          else porMes[k].despesas_pagas += v;
        }
      }
    }

    for (const p of manutPagos || []) {
      if (!p.data_pagamento) continue;
      const k = chaveMes(new Date(p.data_pagamento));
      if (k in porMes) porMes[k].manut_recebido += Number(p.valor) || 0;
    }

    // ── Totais do mês corrente ──
    let aReceber = 0, aPagar = 0;
    let atrasadosReceber = 0, atrasadosPagar = 0;
    let atrasadosReceberQtd = 0, atrasadosPagarQtd = 0;

    for (const l of abertos || []) {
      const v = Number(l.valor) || 0;
      const venc = String(l.data_vencimento || "");
      if (venc.slice(0, 7) === mesAtual) {
        if (l.tipo === "receita") aReceber += v;
        else aPagar += v;
      }
      const atrasado = l.status === "atrasado" || (l.status === "previsto" && venc && venc < hojeStr);
      if (atrasado) {
        if (l.tipo === "receita") { atrasadosReceber += v; atrasadosReceberQtd++; }
        else { atrasadosPagar += v; atrasadosPagarQtd++; }
      }
    }

    return jsonOk({
      meses,
      mes_corrente: {
        mes: mesAtual,
        a_receber: aReceber,
        a_pagar: aPagar,
        atrasados_receber: atrasadosReceber,
        atrasados_pagar: atrasadosPagar,
        atrasados_receber_qtd: atrasadosReceberQtd,
        atrasados_pagar_qtd: atrasadosPagarQtd,
      },
      por_mes: porMes,
    });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
