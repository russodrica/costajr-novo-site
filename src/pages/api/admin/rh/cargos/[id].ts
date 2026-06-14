import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";

export const prerender = false;

// PATCH — renomear / mudar área / ativar-desativar
export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const body = await request.json();
    const patch: Record<string, unknown> = {};
    if (body.nome !== undefined) patch.nome = String(body.nome).trim();
    if (body.area !== undefined) patch.area = body.area || null;
    if (typeof body.ativo === "boolean") patch.ativo = body.ativo;
    if (!Object.keys(patch).length) return jsonErr(400, "Nada para atualizar.");
    const db = supabaseAdmin();
    const { data, error } = await db.from("rh_cargos").update(patch).eq("id", params.id!).select().single();
    if (error) return jsonErr(error.code === "23505" ? 409 : 400, error.code === "23505" ? "Já existe um cargo com esse nome." : error.message);
    await registrarAcao(db, { req: request, admin }, { acao: "editar", entidade: "rh_cargos", registro_id: params.id, descricao: `Atualizou cargo "${data.nome}"`, dados: patch });
    return jsonOk(data);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// DELETE — exclui o cargo (some da lista de seleção). Soft: marca ativo=false.
export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const db = supabaseAdmin();
    const { data: c } = await db.from("rh_cargos").select("nome").eq("id", params.id!).maybeSingle();
    const { error } = await db.from("rh_cargos").update({ ativo: false }).eq("id", params.id!);
    if (error) return jsonErr(400, error.message);
    await registrarAcao(db, { req: request, admin }, { acao: "excluir", entidade: "rh_cargos", registro_id: params.id, descricao: `Removeu cargo "${c?.nome || params.id}"`, dados: {} });
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
