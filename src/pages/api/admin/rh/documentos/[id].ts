import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";

export const prerender = false;

// PATCH /api/admin/rh/documentos/[id] — edita documento
export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    await requireAdminCookie(request);
    const id = params.id!;
    const body = await request.json();

    const editaveis = ["colaborador_id", "titulo", "tipo", "url", "validade", "observacoes"];
    const patch: Record<string, unknown> = {};
    for (const c of editaveis) if (body[c] !== undefined) patch[c] = body[c] === "" ? null : body[c];
    if (!Object.keys(patch).length) return jsonErr(400, "Nada para atualizar");
    if (patch.titulo === null) return jsonErr(400, "Título não pode ficar vazio");
    if (patch.colaborador_id === null) return jsonErr(400, "Colaborador é obrigatório");

    const db = supabaseAdmin();
    const { data, error } = await db.from("rh_documentos").update(patch).eq("id", id).select().single();
    if (error) return jsonErr(400, error.message);
    return jsonOk(data);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// DELETE /api/admin/rh/documentos/[id] — exclui documento
export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    await requireAdminCookie(request);
    const id = params.id!;
    const db = supabaseAdmin();
    const { error } = await db.from("rh_documentos").delete().eq("id", id);
    if (error) return jsonErr(400, error.message);
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
