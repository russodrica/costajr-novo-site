import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";

export const prerender = false;

// POST /api/admin/fin/ofx/conciliar
//  { extrato_id, lancamento_id }        → concilia com lançamento existente
//  { extrato_id, acao: "ignorar" }      → marca como ignorado
//  { extrato_id, criar_lancamento:true} → cria lançamento novo já pago e vincula
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const body = await request.json();
    const { extrato_id, lancamento_id, acao, criar_lancamento } = body || {};
    if (!extrato_id) return jsonErr(400, "extrato_id é obrigatório");

    const db = supabaseAdmin();
    const { data: extrato, error: eExt } = await db.from("fin_extrato_ofx")
      .select("*").eq("id", extrato_id).single();
    if (eExt || !extrato) return jsonErr(404, "Transação do extrato não encontrada");
    if (extrato.status !== "pendente")
      return jsonErr(400, `Transação já está com status "${extrato.status}"`);

    // ── Ignorar ──
    if (acao === "ignorar") {
      const { error } = await db.from("fin_extrato_ofx")
        .update({ status: "ignorado" }).eq("id", extrato_id);
      if (error) return jsonErr(500, error.message);
      return jsonOk({ ok: true, status: "ignorado" });
    }

    // ── Criar lançamento novo e conciliar ──
    if (criar_lancamento === true) {
      const valor = Number(extrato.valor);
      const novo = {
        tipo: valor > 0 ? "receita" : "despesa",
        descricao: extrato.descricao || "Lançamento do extrato OFX",
        valor: Math.abs(valor),
        data_vencimento: extrato.data,
        data_pagamento: extrato.data,
        status: "pago",
        conciliado: true,
        observacoes: `Criado via conciliação OFX (conta ${extrato.conta || "?"}, FITID ${extrato.fitid})`,
        criado_por: admin.email,
      };
      const { data: lanc, error: eIns } = await db.from("fin_lancamentos")
        .insert(novo).select().single();
      if (eIns) return jsonErr(500, eIns.message);

      const { error: eUpd } = await db.from("fin_extrato_ofx")
        .update({ status: "conciliado", lancamento_id: lanc.id }).eq("id", extrato_id);
      if (eUpd) return jsonErr(500, eUpd.message);
      return jsonOk({ ok: true, status: "conciliado", lancamento: lanc });
    }

    // ── Conciliar com lançamento existente ──
    if (!lancamento_id) return jsonErr(400, "Informe lancamento_id, acao:'ignorar' ou criar_lancamento:true");

    const { data: lanc, error: eLanc } = await db.from("fin_lancamentos")
      .select("id, status, conciliado").eq("id", lancamento_id).single();
    if (eLanc || !lanc) return jsonErr(404, "Lançamento não encontrado");
    if (lanc.conciliado) return jsonErr(400, "Este lançamento já foi conciliado com outra transação");

    const updLanc: Record<string, unknown> = { conciliado: true };
    if (lanc.status === "previsto" || lanc.status === "atrasado") {
      updLanc.status = "pago";
      updLanc.data_pagamento = extrato.data;
    }
    const { error: eU1 } = await db.from("fin_lancamentos").update(updLanc).eq("id", lancamento_id);
    if (eU1) return jsonErr(500, eU1.message);

    const { error: eU2 } = await db.from("fin_extrato_ofx")
      .update({ status: "conciliado", lancamento_id }).eq("id", extrato_id);
    if (eU2) return jsonErr(500, eU2.message);

    return jsonOk({ ok: true, status: "conciliado" });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
