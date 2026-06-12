import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";

export const prerender = false;

const CLIMAS = ["sol", "nublado", "chuva", "impraticavel"];

function validarCampos(body: Record<string, any>): string | null {
  if (body.clima_manha && !CLIMAS.includes(body.clima_manha)) return "Clima da manhã inválido";
  if (body.clima_tarde && !CLIMAS.includes(body.clima_tarde)) return "Clima da tarde inválido";
  if (body.efetivo !== undefined && body.efetivo !== null && body.efetivo !== "") {
    const n = Number(body.efetivo);
    if (!Number.isInteger(n) || n < 0) return "Efetivo deve ser um número inteiro ≥ 0";
  }
  if (body.fotos !== undefined && body.fotos !== null && !Array.isArray(body.fotos)) return "Fotos deve ser uma lista de URLs";
  return null;
}

// GET /api/admin/obras/[id]/rdo — lista RDOs da obra (mais recentes primeiro)
export const GET: APIRoute = async ({ request, params }) => {
  try {
    await requireAdminCookie(request);
    const db = supabaseAdmin();
    const { data, error } = await db
      .from("obras_rdo")
      .select("*")
      .eq("obra_id", params.id!)
      .order("data", { ascending: false })
      .limit(500);
    if (error) return jsonErr(500, error.message);
    return jsonOk(data || []);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// POST /api/admin/obras/[id]/rdo — cria RDO do dia
export const POST: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const body = await request.json();
    if (!body.data) return jsonErr(400, "Data do RDO é obrigatória");
    if (!body.atividades || !String(body.atividades).trim()) return jsonErr(400, "Descreva as atividades do dia");
    const invalido = validarCampos(body);
    if (invalido) return jsonErr(400, invalido);

    const row: Record<string, unknown> = {
      obra_id: params.id!,
      data: body.data,
      clima_manha: body.clima_manha || null,
      clima_tarde: body.clima_tarde || null,
      efetivo: body.efetivo === "" || body.efetivo == null ? null : Number(body.efetivo),
      atividades: String(body.atividades).trim(),
      ocorrencias: body.ocorrencias?.trim() || null,
      equipamentos: body.equipamentos?.trim() || null,
      fotos: Array.isArray(body.fotos) ? body.fotos : [],
      criado_por: admin.email,
    };
    const db = supabaseAdmin();
    const { data, error } = await db.from("obras_rdo").insert(row).select().single();
    if (error) {
      if (error.code === "23505" || /duplicate|unique/i.test(error.message))
        return jsonErr(409, "Já existe RDO desta data — edite o existente");
      return jsonErr(400, error.message);
    }
    return jsonOk(data, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// PATCH /api/admin/obras/[id]/rdo — body: { id, ...campos }
export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    await requireAdminCookie(request);
    const body = await request.json();
    if (!body.id) return jsonErr(400, "Informe o id do RDO");
    if (body.atividades !== undefined && !String(body.atividades).trim()) return jsonErr(400, "Atividades não pode ficar vazio");
    const invalido = validarCampos(body);
    if (invalido) return jsonErr(400, invalido);

    const patch: Record<string, unknown> = {};
    if (body.data !== undefined && body.data !== "") patch.data = body.data;
    if (body.clima_manha !== undefined) patch.clima_manha = body.clima_manha || null;
    if (body.clima_tarde !== undefined) patch.clima_tarde = body.clima_tarde || null;
    if (body.efetivo !== undefined) patch.efetivo = body.efetivo === "" || body.efetivo == null ? null : Number(body.efetivo);
    if (body.atividades !== undefined) patch.atividades = String(body.atividades).trim();
    if (body.ocorrencias !== undefined) patch.ocorrencias = body.ocorrencias?.trim() || null;
    if (body.equipamentos !== undefined) patch.equipamentos = body.equipamentos?.trim() || null;
    if (body.fotos !== undefined) patch.fotos = Array.isArray(body.fotos) ? body.fotos : [];

    const db = supabaseAdmin();
    const { data, error } = await db
      .from("obras_rdo")
      .update(patch)
      .eq("id", body.id)
      .eq("obra_id", params.id!)
      .select()
      .single();
    if (error) {
      if (error.code === "23505" || /duplicate|unique/i.test(error.message))
        return jsonErr(409, "Já existe RDO desta data — edite o existente");
      return jsonErr(400, error.message);
    }
    return jsonOk(data);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
