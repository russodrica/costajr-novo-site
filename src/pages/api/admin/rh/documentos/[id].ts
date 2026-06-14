import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { excluirComLixeira, registrarAcao } from "../../../../../lib/auditoria";

export const prerender = false;

// PATCH /api/admin/rh/documentos/[id] — edita documento
export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const id = params.id!;
    const body = await request.json();

    const editaveis = ["colaborador_id", "titulo", "tipo", "url", "validade", "validade_na", "observacoes"];
    const patch: Record<string, unknown> = {};
    for (const c of editaveis) if (body[c] !== undefined) patch[c] = body[c] === "" ? null : body[c];
    if (patch.validade_na === null) patch.validade_na = false;
    if (!Object.keys(patch).length) return jsonErr(400, "Nada para atualizar");
    if (patch.titulo === null) return jsonErr(400, "Título não pode ficar vazio");
    if (patch.colaborador_id === null) return jsonErr(400, "Colaborador é obrigatório");

    const db = supabaseAdmin();
    const { data, error } = await db.from("rh_documentos").update(patch).eq("id", id).select().single();
    if (error) return jsonErr(400, error.message);
    await registrarAcao(db, { req: request, admin }, { acao: "editar", entidade: "rh_documentos", registro_id: id, descricao: `Editou documento "${data.titulo}"`, dados: patch });
    return jsonOk(data);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// DELETE /api/admin/rh/documentos/[id] — exclui documento (vai para a lixeira por 30 dias)
export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const id = params.id!;
    const db = supabaseAdmin();
    const { data: doc } = await db.from("rh_documentos").select("titulo").eq("id", id).maybeSingle();
    const r = await excluirComLixeira(db, { req: request, admin }, {
      tabela: "rh_documentos", id, entidade: "rh_documentos",
      descricao: doc ? `Excluiu documento "${doc.titulo}"` : `Excluiu documento ${id}`,
    });
    if (!r.ok) return jsonErr(400, r.error || "Falha ao excluir");
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
