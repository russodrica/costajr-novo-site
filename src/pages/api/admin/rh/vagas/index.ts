import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";
import { bloqueioSeSoLeitura } from "../../../../../lib/permissoes";

export const prerender = false;

const STATUS = ["aberta", "em_andamento", "preenchida", "cancelada"];
export const VAGA_CAMPOS = ["titulo", "cargo", "regime", "setor", "demandante", "quantidade", "descricao", "status",
  "data_abertura", "data_prevista", "demanda", "perfil_desejado", "habilitacao", "modo_trabalho", "tipo_contratacao"];

// GET /api/admin/rh/vagas — lista vagas (com contagem de candidatos)
export const GET: APIRoute = async ({ request }) => {
  try {
    await requireAdminCookie(request);
    const db = supabaseAdmin();
    const { data: vagas } = await db.from("rh_vagas").select("*").order("created_at", { ascending: false }).limit(500);
    const { data: cand } = await db.from("rh_candidatos").select("vaga_id, etapa").limit(5000);
    const porVaga: Record<string, { total: number; ativos: number }> = {};
    for (const c of cand || []) {
      const k = c.vaga_id || "_";
      porVaga[k] = porVaga[k] || { total: 0, ativos: 0 };
      porVaga[k].total++;
      if (!["contratado", "reprovado"].includes(c.etapa)) porVaga[k].ativos++;
    }
    return jsonOk((vagas || []).map((v: any) => ({ ...v, candidatos: porVaga[v.id] || { total: 0, ativos: 0 } })));
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// POST /api/admin/rh/vagas — cria vaga
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const _ro = await bloqueioSeSoLeitura(admin, "recrutamento"); if (_ro) return _ro;
    const body = await request.json();
    if (!body.titulo) return jsonErr(400, "Título é obrigatório.");
    if (body.status && !STATUS.includes(body.status)) return jsonErr(400, "Status inválido.");
    const row: any = { criado_por: admin.email };
    for (const c of VAGA_CAMPOS) if (body[c] !== undefined && body[c] !== "") row[c] = body[c];
    const db = supabaseAdmin();
    const { data, error } = await db.from("rh_vagas").insert(row).select().single();
    if (error) return jsonErr(400, error.message);
    await registrarAcao(db, { req: request, admin }, { acao: "criar", entidade: "rh_vagas", registro_id: data.id, descricao: `Abriu vaga "${data.titulo}"`, dados: data });
    return jsonOk(data, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
