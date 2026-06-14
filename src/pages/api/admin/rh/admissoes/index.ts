import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";
import { registrarAcao } from "~/lib/auditoria";

export const prerender = false;

// GET /api/admin/rh/admissoes — lista admissões com documentos enviados
export const GET: APIRoute = async ({ request }) => {
  try {
    await requireAdminCookie(request);
    const db = supabaseAdmin();
    const { data, error } = await db
      .from("rh_admissoes")
      .select("*, rh_admissoes_docs(id, tipo, nome_arquivo, created_at)")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) return jsonErr(500, error.message);
    return jsonOk((data || []).map((a: any) => ({ ...a, docs_count: (a.rh_admissoes_docs || []).length })));
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// POST /api/admin/rh/admissoes — cria admissão e retorna o registro (com token do link)
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const body = await request.json();
    const nome = String(body.nome || "").trim();
    if (!nome) return jsonErr(400, "Nome é obrigatório");

    const regimesValidos = ["clt", "pj", "estagio", "temporario"];
    const row: Record<string, unknown> = { nome, criado_por: admin.email };
    if (body.email) row.email = String(body.email).trim();
    if (body.telefone) row.telefone = String(body.telefone).trim();
    if (body.cargo) row.cargo = String(body.cargo).trim();
    if (body.regime) {
      if (!regimesValidos.includes(body.regime)) return jsonErr(400, "Regime inválido");
      row.regime = body.regime;
    }
    if (body.observacoes) row.observacoes = String(body.observacoes).trim();

    const db = supabaseAdmin();
    const { data, error } = await db.from("rh_admissoes").insert(row).select().single();
    if (error) return jsonErr(400, error.message);
    await registrarAcao(db, { req: request, admin }, {
      acao: "criar",
      entidade: "rh_admissoes",
      registro_id: data?.id ?? null,
      descricao: `Criou admissão digital "${nome}"`,
      dados: data,
    });
    return jsonOk(data, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
