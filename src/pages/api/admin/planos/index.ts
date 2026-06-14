import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";
import { registrarAcao } from "../../../../lib/auditoria";

export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const body = await request.json();
    if (!body.nome || !body.valor_mensal || !body.numero_preventivas) return jsonErr(400, "nome, valor_mensal e numero_preventivas são obrigatórios");
    const db = supabaseAdmin();
    const { data, error } = await db.from("manut_planos").insert(body).select().single();
    if (error) return jsonErr(400, error.message);
    await registrarAcao(db, { req: request, admin }, { acao: "criar", entidade: "manut_planos", registro_id: data?.id ?? null, descricao: `Criou plano "${data?.nome ?? body.nome}"`, dados: data });
    return jsonOk(data, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
