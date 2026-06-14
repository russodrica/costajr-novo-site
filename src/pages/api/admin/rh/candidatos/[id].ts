import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { excluirComLixeira, registrarAcao } from "../../../../../lib/auditoria";
import { ETAPAS } from "./index";

export const prerender = false;

// PATCH — edita ou MOVE de etapa (kanban)
export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const id = params.id!;
    const body = await request.json();
    if (body.etapa && !ETAPAS.includes(body.etapa)) return jsonErr(400, "Etapa inválida.");
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const c of ["vaga_id", "nome", "email", "telefone", "etapa", "origem", "teste_resultado", "entrevista_comportamental_em", "entrevista_tecnica_em", "feedback", "motivo_reprovacao", "observacoes"]) if (body[c] !== undefined) patch[c] = body[c] === "" ? null : body[c];
    const db = supabaseAdmin();
    const { data, error } = await db.from("rh_candidatos").update(patch).eq("id", id).select().single();
    if (error) return jsonErr(400, error.message);
    const descr = body.etapa ? `Moveu candidato "${data.nome}" para etapa ${body.etapa}` : `Editou candidato "${data.nome}"`;
    await registrarAcao(db, { req: request, admin }, { acao: "editar", entidade: "rh_candidatos", registro_id: id, descricao: descr, dados: patch });
    return jsonOk(data);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const db = supabaseAdmin();
    const { data: c } = await db.from("rh_candidatos").select("nome").eq("id", params.id!).maybeSingle();
    const r = await excluirComLixeira(db, { req: request, admin }, { tabela: "rh_candidatos", id: params.id!, entidade: "rh_candidatos", descricao: c ? `Excluiu candidato "${c.nome}"` : `Excluiu candidato ${params.id}` });
    if (!r.ok) return jsonErr(400, r.error || "Falha ao excluir");
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
