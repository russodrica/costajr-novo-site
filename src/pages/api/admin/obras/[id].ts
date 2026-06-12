import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";

export const prerender = false;

// GET /api/admin/obras/[id] — detalhe + ativos alocados na obra
export const GET: APIRoute = async ({ request, params }) => {
  try {
    await requireAdminCookie(request);
    const db = supabaseAdmin();
    const [{ data: obra, error }, { data: ativos }] = await Promise.all([
      db.from("obras").select("*").eq("id", params.id!).maybeSingle(),
      db.from("ativos").select("id, descricao, categoria, status, numero_patrimonial").eq("alocado_para_tipo", "obra").eq("alocado_para_id", params.id!),
    ]);
    if (error) return jsonErr(500, error.message);
    if (!obra) return jsonErr(404, "Obra não encontrada");
    return jsonOk({ obra, ativos: ativos || [] });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// PATCH /api/admin/obras/[id]
export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    await requireAdminCookie(request);
    const body = await request.json();
    const campos = ["nome", "codigo", "cliente", "endereco", "cidade", "uf", "status", "data_inicio", "data_fim_prevista", "data_fim_real", "responsavel_nome", "valor_contrato", "observacoes"];
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const c of campos) if (body[c] !== undefined) patch[c] = body[c] === "" ? null : body[c];
    const db = supabaseAdmin();
    const { data, error } = await db.from("obras").update(patch).eq("id", params.id!).select().single();
    if (error) return jsonErr(400, error.message);
    return jsonOk(data);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
