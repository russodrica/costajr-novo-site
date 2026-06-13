import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";

export const prerender = false;

// GET /api/admin/fin/resumo?meses=6
// Consolida fin_lancamentos + manut_pagamentos na visão de caixa.
// A agregação é feita NO BANCO (função fin_resumo_caixa) — correto e rápido
// mesmo com 25k+ lançamentos (antes era em JS sobre .limit(5000), o que truncava).
export const GET: APIRoute = async ({ request, url }) => {
  try {
    await requireAdminCookie(request);
    const db = supabaseAdmin();
    const meses = Math.min(24, Math.max(1, Number(url.searchParams.get("meses")) || 6));

    const { data, error } = await db.rpc("fin_resumo_caixa", { p_meses: meses });
    if (error) return jsonErr(500, error.message);

    const cards = data?.cards || {};
    return jsonOk({
      meses,
      mes_corrente: {
        mes: data?.mes_corrente,
        a_receber: Number(cards.a_receber) || 0,
        a_pagar: Number(cards.a_pagar) || 0,
        atrasados_receber: Number(cards.atrasados_receber) || 0,
        atrasados_pagar: Number(cards.atrasados_pagar) || 0,
        atrasados_receber_qtd: Number(cards.atrasados_receber_qtd) || 0,
        atrasados_pagar_qtd: Number(cards.atrasados_pagar_qtd) || 0,
      },
      por_mes: data?.por_mes || {},
    });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
