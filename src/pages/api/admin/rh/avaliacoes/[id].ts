import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { excluirComLixeira } from "../../../../../lib/auditoria";

export const prerender = false;

export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const db = supabaseAdmin();
    const r = await excluirComLixeira(db, { req: request, admin }, { tabela: "rh_avaliacoes", id: params.id!, entidade: "rh_avaliacoes", descricao: `Excluiu avaliação ${params.id}` });
    if (!r.ok) return jsonErr(400, r.error || "Falha ao excluir");
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
