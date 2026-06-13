import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";

export const prerender = false;

const CAMPOS = [
  "disciplina", "macrogrupo", "grupo", "descricao", "unidade",
  "custo_material", "custo_mao_obra", "fonte", "status_auditoria",
  "sinapi_codigo", "sinapi_preco", "sinapi_data", "valor_referencia",
  "observacoes", "ativo", "data_atualizacao",
];
const NUMERICOS = new Set(["custo_material", "custo_mao_obra", "sinapi_preco", "valor_referencia"]);

// PATCH /api/admin/orcamentos/servicos/[codigo]
export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    await requireAdminCookie(request);
    const body = await request.json();
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const c of CAMPOS) {
      if (body[c] === undefined) continue;
      if (body[c] === "" && c !== "status_auditoria") { patch[c] = null; continue; }
      patch[c] = NUMERICOS.has(c) ? Number(body[c]) : body[c];
    }
    const db = supabaseAdmin();
    const { data, error } = await db.from("orc_servicos").update(patch).eq("codigo", params.codigo!).select().single();
    if (error) return jsonErr(400, error.message);
    if (!data) return jsonErr(404, "Serviço não encontrado");
    return jsonOk(data);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// DELETE /api/admin/orcamentos/servicos/[codigo]?hard=1
//   Padrão: desativa (ativo=false), preservando histórico. hard=1 apaga de vez.
export const DELETE: APIRoute = async ({ request, params, url }) => {
  try {
    await requireAdminCookie(request);
    const db = supabaseAdmin();
    if (url.searchParams.get("hard") === "1") {
      const { error } = await db.from("orc_servicos").delete().eq("codigo", params.codigo!);
      if (error) return jsonErr(400, error.message);
      return jsonOk({ ok: true, apagado: true });
    }
    const { data, error } = await db.from("orc_servicos")
      .update({ ativo: false, updated_at: new Date().toISOString() })
      .eq("codigo", params.codigo!).select().single();
    if (error) return jsonErr(400, error.message);
    if (!data) return jsonErr(404, "Serviço não encontrado");
    return jsonOk({ ok: true, desativado: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
