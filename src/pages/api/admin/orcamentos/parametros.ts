import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";

export const prerender = false;

// GET /api/admin/orcamentos/parametros — lista parâmetros de BDI
export const GET: APIRoute = async ({ request }) => {
  try {
    await requireAdminCookie(request);
    const db = supabaseAdmin();
    const { data, error } = await db.from("orc_parametros_bdi").select("*").order("ordem");
    if (error) return jsonErr(500, error.message);
    return jsonOk(data || []);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// PATCH /api/admin/orcamentos/parametros — atualiza valores
//   body: { itens: [{ chave, valor, observacao }] }  ou  { chave, valor, observacao }
export const PATCH: APIRoute = async ({ request }) => {
  try {
    await requireAdminCookie(request);
    const body = await request.json();
    const itens = Array.isArray(body.itens) ? body.itens : [body];
    const db = supabaseAdmin();
    const atualizados: unknown[] = [];
    for (const it of itens) {
      if (!it || !it.chave) continue;
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (it.valor !== undefined) patch.valor = it.valor === "" || it.valor === null ? null : Number(it.valor);
      if (it.observacao !== undefined) patch.observacao = it.observacao;
      if (it.rotulo !== undefined) patch.rotulo = it.rotulo;
      const { data, error } = await db.from("orc_parametros_bdi").update(patch).eq("chave", it.chave).select().single();
      if (error) return jsonErr(400, `${it.chave}: ${error.message}`);
      if (data) atualizados.push(data);
    }
    return jsonOk({ ok: true, atualizados });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
