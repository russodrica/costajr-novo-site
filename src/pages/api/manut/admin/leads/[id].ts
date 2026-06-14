import type { APIRoute } from "astro";
import { requireAdmin, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";
import { excluirComLixeira, registrarAcao } from "~/lib/auditoria";

export const prerender = false;

export const PUT: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdmin(request);
    const { id } = params;
    if (!id) return jsonErr(400, "id obrigatório");

    const body = await request.json();
    const allowed = ["etapa", "observacoes", "nome", "nome_loja", "email", "telefone", "plano", "valor"];
    const update: Record<string, any> = { updated_at: new Date().toISOString() };
    for (const k of allowed) {
      if (k in body) update[k] = body[k];
    }

    const db = supabaseAdmin();
    const { error } = await db.from("manut_leads").update(update).eq("id", id);
    if (error) throw new Error(error.message);
    await registrarAcao(db, { req: request, admin }, { acao: "editar", entidade: "manut_leads", registro_id: id, descricao: `Editou lead ${id}`, dados: update });
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autorizado" ? 401 : 500, e.message);
  }
};

export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdmin(request);
    const { id } = params;
    if (!id) return jsonErr(400, "id obrigatório");
    const db = supabaseAdmin();
    const { data: lead } = await db.from("manut_leads").select("nome").eq("id", id).maybeSingle();
    const r = await excluirComLixeira(db, { req: request, admin }, {
      tabela: "manut_leads", id, idCol: "id", entidade: "manut_leads",
      descricao: lead?.nome ? `Excluiu lead "${lead.nome}"` : `Excluiu lead ${id}`,
    });
    if (!r.ok) return jsonErr(400, r.error || "Falha ao excluir");
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autorizado" ? 401 : 500, e.message);
  }
};
