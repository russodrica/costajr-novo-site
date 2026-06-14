import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";
import { registrarAcao } from "../../../../lib/auditoria";

export const prerender = false;

// GET /api/admin/depositos?ativos=1  → lista de depósitos (todos, ou só ativos)
export const GET: APIRoute = async ({ request, url }) => {
  try {
    await requireAdminCookie(request);
    const db = supabaseAdmin();
    let q = db.from("depositos").select("*").order("ativo", { ascending: false }).order("nome");
    if (url.searchParams.get("ativos") === "1") q = q.eq("ativo", true);
    const { data, error } = await q;
    if (error) return jsonErr(500, error.message);
    return jsonOk(data || []);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// POST /api/admin/depositos  → cria depósito
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const body = await request.json();
    const nome = String(body.nome || "").trim();
    if (!nome) return jsonErr(400, "Informe o nome do depósito.");
    const row: Record<string, unknown> = { nome, criado_por: admin.email };
    for (const c of ["endereco", "cidade", "uf", "responsavel", "observacoes"]) {
      if (body[c] !== undefined && body[c] !== "") row[c] = body[c];
    }
    const db = supabaseAdmin();
    const { data, error } = await db.from("depositos").insert(row).select().single();
    if (error) return jsonErr(400, error.message);
    await registrarAcao(db, { req: request, admin }, {
      acao: "criar", entidade: "depositos", registro_id: data.id,
      descricao: `Criou o depósito "${data.nome}"`, dados: data,
    });
    return jsonOk(data, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
