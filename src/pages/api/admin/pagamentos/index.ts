import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";
import { registrarAcao } from "../../../../lib/auditoria";

export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const body = await request.json();
    if (!body.cliente_id || !body.valor) return jsonErr(400, "cliente_id e valor são obrigatórios");
    const db = supabaseAdmin();
    const { data, error } = await db.from("manut_pagamentos").insert(body).select().single();
    if (error) return jsonErr(400, error.message);
    await registrarAcao(db, { req: request, admin }, {
      acao: "criar",
      entidade: "manut_pagamentos",
      registro_id: data?.id ?? null,
      descricao: `Lançou pagamento de R$ ${data?.valor ?? body.valor} (cliente ${data?.cliente_id ?? body.cliente_id})`,
      dados: data,
    });
    return jsonOk(data, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
