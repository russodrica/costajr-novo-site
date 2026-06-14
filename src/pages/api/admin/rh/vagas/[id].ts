import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { excluirComLixeira, registrarAcao } from "../../../../../lib/auditoria";

export const prerender = false;

export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const id = params.id!;
    const body = await request.json();
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const c of ["titulo", "cargo", "regime", "setor", "demandante", "quantidade", "descricao", "status"]) if (body[c] !== undefined) patch[c] = body[c] === "" ? null : body[c];
    const db = supabaseAdmin();
    const { data, error } = await db.from("rh_vagas").update(patch).eq("id", id).select().single();
    if (error) return jsonErr(400, error.message);
    await registrarAcao(db, { req: request, admin }, { acao: "editar", entidade: "rh_vagas", registro_id: id, descricao: `Editou vaga "${data.titulo}"`, dados: patch });
    return jsonOk(data);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const db = supabaseAdmin();
    const { data: v } = await db.from("rh_vagas").select("titulo").eq("id", params.id!).maybeSingle();
    const r = await excluirComLixeira(db, { req: request, admin }, { tabela: "rh_vagas", id: params.id!, entidade: "rh_vagas", descricao: v ? `Excluiu vaga "${v.titulo}"` : `Excluiu vaga ${params.id}` });
    if (!r.ok) return jsonErr(400, r.error || "Falha ao excluir");
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
