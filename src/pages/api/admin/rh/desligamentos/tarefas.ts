import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { bloqueioSeSoLeitura } from "../../../../../lib/permissoes";
import { registrarAcao } from "../../../../../lib/auditoria";

export const prerender = false;

// GET /api/admin/rh/desligamentos/tarefas?colaborador_id=ID → lista as tarefas.
export const GET: APIRoute = async ({ request, url }) => {
  try {
    await requireAdminCookie(request);
    const colaborador_id = url.searchParams.get("colaborador_id");
    if (!colaborador_id) return jsonErr(400, "colaborador_id é obrigatório.");
    const db = supabaseAdmin();
    const { data } = await db.from("rh_desligamento_tarefas").select("*")
      .eq("colaborador_id", colaborador_id).order("status").order("categoria").order("sistema");
    return jsonOk(data || []);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// PATCH /api/admin/rh/desligamentos/tarefas { tarefa_id, concluir?, observacao? }
export const PATCH: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const _ro = await bloqueioSeSoLeitura(admin, "rh"); if (_ro) return _ro;
    const { tarefa_id, concluir, observacao } = await request.json();
    if (!tarefa_id) return jsonErr(400, "tarefa_id é obrigatório.");
    const db = supabaseAdmin();
    const patch: any = { updated_at: new Date().toISOString() };
    if (concluir === false) { patch.status = "pendente"; patch.concluida_em = null; patch.concluida_por = null; }
    else { patch.status = "concluida"; patch.concluida_em = new Date().toISOString(); patch.concluida_por = admin.email; }
    if (observacao !== undefined) patch.observacao = observacao;
    const { data, error } = await db.from("rh_desligamento_tarefas").update(patch).eq("id", tarefa_id).select().single();
    if (error) return jsonErr(400, error.message);
    await registrarAcao(db, { req: request, admin }, {
      acao: "editar", entidade: "rh_desligamento_tarefas", registro_id: tarefa_id,
      descricao: `${patch.status === "concluida" ? "Concluiu" : "Reabriu"} tarefa de desligamento: ${data?.sistema}`, dados: patch,
    }).catch(() => {});
    return jsonOk(data);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
