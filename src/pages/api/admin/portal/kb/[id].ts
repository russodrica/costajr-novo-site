import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { requireAdminCookie, jsonOk, jsonErr } from "~/lib/auth";
import { excluirComLixeira, registrarAcao } from "~/lib/auditoria";

export const prerender = false;

export const PUT: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const id = params.id!;
    const body = await request.json();
    const sb = supabaseAdmin();
    const patch = { ...body, updated_at: new Date().toISOString() };
    const { data, error } = await sb.from("portal_kb").update(patch).eq("id", id).select().single();
    if (error) return jsonErr(500, "Erro ao atualizar.");
    await registrarAcao(sb, { req: request, admin }, { acao: "editar", entidade: "portal_kb", registro_id: id, descricao: `Editou Q&A da base de conhecimento ${id}`, dados: patch });
    return jsonOk(data);
  } catch { return jsonErr(401, "Não autenticado."); }
};

export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const id = params.id!;
    const db = supabaseAdmin();
    const { data: kb } = await db.from("portal_kb").select("question").eq("id", id).maybeSingle();
    const r = await excluirComLixeira(db, { req: request, admin }, {
      tabela: "portal_kb", id, idCol: "id", entidade: "portal_kb",
      descricao: kb ? `Excluiu Q&A "${kb.question}"` : `Excluiu Q&A da base de conhecimento ${id}`,
    });
    if (!r.ok) return jsonErr(400, r.error || "Falha ao excluir");
    return jsonOk({ ok: true });
  } catch { return jsonErr(401, "Não autenticado."); }
};
