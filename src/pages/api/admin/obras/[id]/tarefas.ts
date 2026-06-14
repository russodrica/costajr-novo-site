import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { excluirComLixeira, registrarAcao } from "../../../../../lib/auditoria";

export const prerender = false;

const STATUS = ["pendente", "em_andamento", "concluida", "cancelada"];
const PRIORIDADES = ["baixa", "media", "alta"];

// GET — lista tarefas da obra (cronograma)
export const GET: APIRoute = async ({ request, params }) => {
  try {
    await requireAdminCookie(request);
    const db = supabaseAdmin();
    const { data, error } = await db
      .from("obras_tarefas").select("*")
      .eq("obra_id", params.id!)
      .order("ordem").order("data_inicio", { ascending: true, nullsFirst: false })
      .limit(2000);
    if (error) return jsonErr(500, error.message);
    return jsonOk(data || []);
  } catch (e: any) { return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message); }
};

// POST — cria tarefa
export const POST: APIRoute = async ({ request, params }) => {
  try {
    await requireAdminCookie(request);
    const b = await request.json();
    if (!b.titulo?.trim()) return jsonErr(400, "Informe o título da tarefa.");
    if (b.status && !STATUS.includes(b.status)) return jsonErr(400, "Status inválido.");
    if (b.prioridade && !PRIORIDADES.includes(b.prioridade)) return jsonErr(400, "Prioridade inválida.");
    const db = supabaseAdmin();
    const { data, error } = await db.from("obras_tarefas").insert({
      obra_id: params.id!,
      titulo: b.titulo.trim(),
      descricao: b.descricao || null,
      etapa: b.etapa || null,
      responsavel: b.responsavel || null,
      status: b.status || "pendente",
      prioridade: b.prioridade || null,
      data_inicio: b.data_inicio || null,
      data_fim: b.data_fim || null,
      ordem: Number(b.ordem) || 0,
    }).select().single();
    if (error) return jsonErr(500, error.message);
    return jsonOk(data, 201);
  } catch (e: any) { return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message); }
};

// PATCH ?tarefa=ID — atualiza campos da tarefa
export const PATCH: APIRoute = async ({ request, params, url }) => {
  try {
    const admin = await requireAdminCookie(request);
    const tarefaId = url.searchParams.get("tarefa");
    if (!tarefaId) return jsonErr(400, "Informe ?tarefa=ID.");
    const b = await request.json();
    if (b.status && !STATUS.includes(b.status)) return jsonErr(400, "Status inválido.");
    if (b.prioridade && !PRIORIDADES.includes(b.prioridade)) return jsonErr(400, "Prioridade inválida.");
    const campos: Record<string, any> = {};
    for (const k of ["titulo", "descricao", "etapa", "responsavel", "status", "prioridade", "data_inicio", "data_fim", "ordem"]) {
      if (k in b) campos[k] = b[k] === "" ? null : b[k];
    }
    campos.updated_at = new Date().toISOString();
    const db = supabaseAdmin();
    const { data, error } = await db.from("obras_tarefas").update(campos)
      .eq("id", tarefaId).eq("obra_id", params.id!).select().single();
    if (error) return jsonErr(500, error.message);
    await registrarAcao(db, { req: request, admin }, { acao: "editar", entidade: "obras_tarefas", registro_id: tarefaId, descricao: `Editou tarefa "${data.titulo}"`, dados: campos });
    return jsonOk(data);
  } catch (e: any) { return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message); }
};

// DELETE ?tarefa=ID — exclui tarefa (vai para a lixeira por 30 dias)
export const DELETE: APIRoute = async ({ request, params, url }) => {
  try {
    const admin = await requireAdminCookie(request);
    const tarefaId = url.searchParams.get("tarefa");
    if (!tarefaId) return jsonErr(400, "Informe ?tarefa=ID.");
    const db = supabaseAdmin();
    // Confirma que a tarefa pertence a esta obra (preserva o escopo do .eq("obra_id"))
    // e pega o título para uma descrição legível na lixeira/log.
    const { data: tarefa } = await db
      .from("obras_tarefas").select("titulo")
      .eq("id", tarefaId).eq("obra_id", params.id!).maybeSingle();
    if (!tarefa) return jsonErr(404, "Tarefa não encontrada nesta obra.");
    const r = await excluirComLixeira(db, { req: request, admin }, {
      tabela: "obras_tarefas", id: tarefaId, idCol: "id", entidade: "obras_tarefas",
      descricao: `Excluiu tarefa "${tarefa.titulo}"`,
    });
    if (!r.ok) return jsonErr(400, r.error || "Falha ao excluir");
    return jsonOk({ ok: true });
  } catch (e: any) { return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message); }
};
