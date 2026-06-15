import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";
import { bloqueioSeSoLeitura } from "../../../../../lib/permissoes";

export const prerender = false;

// PATCH /api/admin/fin/lancamentos/[id] — edita campos do lançamento.
// Ação rápida "marcar pago": enviar { status: "pago", data_pagamento: "YYYY-MM-DD" }
export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const _ro = await bloqueioSeSoLeitura(admin, "financeiro"); if (_ro) return _ro;
    const id = params.id!;
    const body = await request.json();

    const editaveis = [
      "tipo", "descricao", "categoria_id", "valor", "data_vencimento", "data_pagamento",
      "status", "forma_pagamento", "fornecedor_cliente", "obra_id", "documento_url",
      "recorrente", "observacoes",
    ];
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const c of editaveis) if (body[c] !== undefined) patch[c] = body[c] === "" ? null : body[c];
    if (Object.keys(patch).length <= 1) return jsonErr(400, "Nada para atualizar");

    if (patch.tipo !== undefined && !["receita", "despesa"].includes(String(patch.tipo)))
      return jsonErr(400, "Tipo inválido");
    if (patch.status !== undefined && !["previsto", "pago", "atrasado", "cancelado"].includes(String(patch.status)))
      return jsonErr(400, "Status inválido");
    if (patch.valor !== undefined && patch.valor !== null) {
      const vn = Number(patch.valor);
      if (isNaN(vn) || vn < 0) return jsonErr(400, "Valor deve ser um número maior ou igual a zero");
    }

    // marcar pago sem data explícita: usa a data de hoje
    if (patch.status === "pago" && !patch.data_pagamento && body.data_pagamento === undefined)
      patch.data_pagamento = new Date().toISOString().slice(0, 10);

    const db = supabaseAdmin();
    const { data, error } = await db.from("fin_lancamentos").update(patch).eq("id", id).select().single();
    if (error) return jsonErr(400, error.message);
    await registrarAcao(db, { req: request, admin }, { acao: "editar", entidade: "fin_lancamentos", registro_id: id, descricao: `Editou lançamento "${data.descricao ?? id}"`, dados: patch });
    return jsonOk(data);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// DELETE /api/admin/fin/lancamentos/[id] — soft delete: marca como cancelado
export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const _ro = await bloqueioSeSoLeitura(admin, "financeiro"); if (_ro) return _ro;
    const id = params.id!;
    const db = supabaseAdmin();
    const { data, error } = await db.from("fin_lancamentos")
      .update({ status: "cancelado", updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) return jsonErr(400, error.message);
    await registrarAcao(db, { req: request, admin }, { acao: "excluir", entidade: "fin_lancamentos", registro_id: id, descricao: `Cancelou (soft delete) lançamento "${data.descricao ?? id}"` });
    return jsonOk(data);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
