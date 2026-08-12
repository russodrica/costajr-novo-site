import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";
import { bloqueioSeSoLeitura } from "../../../../../lib/permissoes";

export const prerender = false;

const MODULO = "negocios";
const STATUS = ["novo", "aprovado", "arquivado"];

// PATCH /api/admin/negocios/proprietarios/[id]  { status?, observacoes? }
// Os dados do proprietário e o TERMO não são editáveis por aqui de propósito:
// o que a pessoa aceitou é registro, não rascunho.
export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const bl = await bloqueioSeSoLeitura(admin, MODULO); if (bl) return bl;
    const db = supabaseAdmin();
    const id = params.id!;

    const { data: atual } = await db.from("negocios_proprietarios").select("id, nome, status").eq("id", id).maybeSingle();
    if (!atual) return jsonErr(404, "Proprietário não encontrado.");

    const body = await request.json().catch(() => null);
    if (!body) return jsonErr(400, "Envie os dados a alterar.");
    const patch: Record<string, unknown> = {};
    if (body.status !== undefined) {
      const s = String(body.status || "");
      if (!STATUS.includes(s)) return jsonErr(400, "Situação inválida.");
      patch.status = s;
    }
    if (body.observacoes !== undefined) patch.observacoes = String(body.observacoes || "").trim() || null;
    if (!Object.keys(patch).length) return jsonErr(400, "Nada para alterar.");
    patch.updated_at = new Date().toISOString();

    const { data, error } = await db.from("negocios_proprietarios").update(patch).eq("id", id).select().single();
    if (error) return jsonErr(400, error.message);

    await registrarAcao(db, { req: request, admin }, {
      acao: "editar", entidade: "negocios_proprietarios", registro_id: id,
      descricao: `Proprietário "${atual.nome}": ${JSON.stringify(patch)}`, dados: patch,
    });
    return jsonOk(data);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
