import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { excluirComLixeira, registrarAcao } from "../../../../../lib/auditoria";

export const prerender = false;

export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const body = await request.json();
    const patch: Record<string, unknown> = {};
    if (typeof body.ativa === "boolean") patch.ativa = body.ativa;
    if (body.titulo !== undefined) patch.titulo = body.titulo;
    if (body.periodo !== undefined) patch.periodo = body.periodo;
    if (!Object.keys(patch).length) return jsonErr(400, "Nada para atualizar.");
    const db = supabaseAdmin();
    const { data, error } = await db.from("rh_clima_pesquisas").update(patch).eq("id", params.id!).select().single();
    if (error) return jsonErr(400, error.message);
    await registrarAcao(db, { req: request, admin }, { acao: "editar", entidade: "rh_clima_pesquisas", registro_id: params.id, descricao: `Atualizou pesquisa de clima "${data.titulo}"${"ativa" in patch ? ` (${patch.ativa ? "reaberta" : "encerrada"})` : ""}`, dados: patch });
    return jsonOk(data);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const db = supabaseAdmin();
    const r = await excluirComLixeira(db, { req: request, admin }, { tabela: "rh_clima_pesquisas", id: params.id!, entidade: "rh_clima_pesquisas", descricao: `Excluiu pesquisa de clima ${params.id}` });
    if (!r.ok) return jsonErr(400, r.error || "Falha ao excluir");
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
