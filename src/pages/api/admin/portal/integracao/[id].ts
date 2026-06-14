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
    const db = supabaseAdmin();
    const { data, error } = await db
      .from("portal_integration_pdfs")
      .update({ ...body, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select().single();
    if (error) return jsonErr(500, "Erro ao atualizar.");
    await registrarAcao(db, { req: request, admin }, { acao: "editar", entidade: "portal_integration_pdfs", registro_id: id, descricao: `Editou PDF de integração ${id}`, dados: body });
    return jsonOk(data);
  } catch { return jsonErr(401, "Não autenticado."); }
};

export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const id = params.id!;
    const db = supabaseAdmin();
    const { data: row } = await db.from("portal_integration_pdfs").select("titulo").eq("id", id).maybeSingle();
    const r = await excluirComLixeira(db, { req: request, admin }, {
      tabela: "portal_integration_pdfs", id, idCol: "id", entidade: "portal_integration_pdfs",
      descricao: row?.titulo ? `Excluiu PDF de integração "${row.titulo}"` : `Excluiu PDF de integração ${id}`,
    });
    if (!r.ok) return jsonErr(400, r.error || "Falha ao excluir");
    return jsonOk({ ok: true });
  } catch { return jsonErr(401, "Não autenticado."); }
};
