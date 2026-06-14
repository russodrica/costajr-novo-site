import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";

export const prerender = false;

// GET /api/admin/rh/desligamentos?colaborador_id=
export const GET: APIRoute = async ({ request, url }) => {
  try {
    await requireAdminCookie(request);
    const db = supabaseAdmin();
    const cid = url.searchParams.get("colaborador_id");
    let q = db.from("rh_desligamentos").select("*").order("created_at", { ascending: false }).limit(500);
    if (cid) q = q.eq("colaborador_id", cid);
    const { data, error } = await q;
    if (error) return jsonErr(500, error.message);
    return jsonOk(data || []);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// POST /api/admin/rh/desligamentos — registra o processo de desligamento
//   { colaborador_id, data_desligamento, tipo, motivo, entrevista, checklist }
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const body = await request.json();
    if (!body.colaborador_id) return jsonErr(400, "colaborador_id é obrigatório.");
    const db = supabaseAdmin();
    const { data: colab } = await db.from("rh_colaboradores").select("nome").eq("id", body.colaborador_id).maybeSingle();
    const row = {
      colaborador_id: body.colaborador_id,
      data_desligamento: body.data_desligamento || new Date().toISOString().slice(0, 10),
      tipo: body.tipo || null, motivo: body.motivo || null,
      entrevista: body.entrevista || null, checklist: body.checklist || null,
      status: body.status === "concluido" ? "concluido" : "aberto",
      criado_por: admin.email,
    };
    const { data, error } = await db.from("rh_desligamentos").insert(row).select().single();
    if (error) return jsonErr(400, error.message);
    await registrarAcao(db, { req: request, admin }, { acao: "criar", entidade: "rh_desligamentos", registro_id: data.id, descricao: `Registrou desligamento de "${colab?.nome || body.colaborador_id}"`, dados: { tipo: row.tipo } });
    return jsonOk(data, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
