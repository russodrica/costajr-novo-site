import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";

export const prerender = false;

export const ETAPAS = ["triagem", "teste", "entrevista_comportamental", "entrevista_tecnica", "proposta", "admissao", "contratado", "reprovado"];

// GET /api/admin/rh/candidatos?vaga_id=  → candidatos (pipeline)
export const GET: APIRoute = async ({ request, url }) => {
  try {
    await requireAdminCookie(request);
    const db = supabaseAdmin();
    let q = db.from("rh_candidatos").select("*, rh_vagas(titulo)").order("updated_at", { ascending: false }).limit(2000);
    const vaga = url.searchParams.get("vaga_id");
    if (vaga) q = q.eq("vaga_id", vaga);
    const { data, error } = await q;
    if (error) return jsonErr(500, error.message);
    return jsonOk(data || []);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// POST /api/admin/rh/candidatos — cadastra candidato
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const body = await request.json();
    if (!body.nome) return jsonErr(400, "Nome é obrigatório.");
    if (body.etapa && !ETAPAS.includes(body.etapa)) return jsonErr(400, "Etapa inválida.");
    const row: any = { criado_por: admin.email };
    for (const c of ["vaga_id", "nome", "email", "telefone", "etapa", "origem", "observacoes"]) if (body[c] !== undefined && body[c] !== "") row[c] = body[c];
    const db = supabaseAdmin();
    const { data, error } = await db.from("rh_candidatos").insert(row).select().single();
    if (error) return jsonErr(400, error.message);
    await registrarAcao(db, { req: request, admin }, { acao: "criar", entidade: "rh_candidatos", registro_id: data.id, descricao: `Cadastrou candidato "${data.nome}"`, dados: data });
    return jsonOk(data, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
