import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";

export const prerender = false;

// Calcula dias corridos entre duas datas (inclusivo)
function calcularDias(inicio: string, fim: string): number | null {
  const i = new Date(`${inicio}T00:00:00Z`).getTime();
  const f = new Date(`${fim}T00:00:00Z`).getTime();
  if (isNaN(i) || isNaN(f) || f < i) return null;
  return Math.round((f - i) / 86400000) + 1;
}

// GET /api/admin/rh/ausencias?colaborador_id=&status=&tipo=
export const GET: APIRoute = async ({ request, url }) => {
  try {
    await requireAdminCookie(request);
    const db = supabaseAdmin();
    let q = db.from("rh_ausencias").select("*, rh_colaboradores(nome)").order("data_inicio", { ascending: false }).limit(1000);

    const colaboradorId = url.searchParams.get("colaborador_id");
    const status = url.searchParams.get("status");
    const tipo = url.searchParams.get("tipo");

    if (colaboradorId) q = q.eq("colaborador_id", colaboradorId);
    if (status && status !== "todos") q = q.eq("status", status);
    if (tipo && tipo !== "todos") q = q.eq("tipo", tipo);

    const { data, error } = await q;
    if (error) return jsonErr(500, error.message);
    return jsonOk(data || []);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// POST /api/admin/rh/ausencias — cria ausência
export const POST: APIRoute = async ({ request }) => {
  try {
    await requireAdminCookie(request);
    const body = await request.json();
    const { colaborador_id, tipo, data_inicio, data_fim } = body;
    if (!colaborador_id || !tipo || !data_inicio || !data_fim) {
      return jsonErr(400, "Colaborador, tipo, data de início e data de fim são obrigatórios");
    }

    const dias = body.dias !== undefined && body.dias !== "" && body.dias !== null
      ? Number(body.dias)
      : calcularDias(data_inicio, data_fim);
    if (dias === null) return jsonErr(400, "Período inválido: data de fim anterior à data de início");

    const row: Record<string, unknown> = { colaborador_id, tipo, data_inicio, data_fim, dias };
    if (body.motivo) row.motivo = body.motivo;
    if (body.observacoes) row.observacoes = body.observacoes;
    if (body.status) row.status = body.status;

    const db = supabaseAdmin();
    const { data, error } = await db.from("rh_ausencias").insert(row).select().single();
    if (error) return jsonErr(400, error.message);
    return jsonOk(data, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
