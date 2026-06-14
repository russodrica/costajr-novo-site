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
    const allowed = ["descricao", "desconto_percentual", "duracao_meses", "usos_maximos", "validade", "ativo"];
    const update: Record<string, any> = {};
    for (const k of allowed) {
      if (k in body) update[k] = body[k];
    }

    if (Object.keys(update).length === 0) return jsonErr(400, "Nenhum campo para atualizar");
    const db = supabaseAdmin();
    const { error } = await db.from("manut_cupons").update(update).eq("id", id);
    if (error) throw new Error(error.message);
    await registrarAcao(db, { req: request, admin }, {
      acao: "editar", entidade: "manut_cupons", registro_id: id,
      descricao: `Editou cupom ${id}`, dados: update,
    });
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
    const { data: cupom } = await db.from("manut_cupons").select("codigo").eq("id", id).maybeSingle();
    const r = await excluirComLixeira(db, { req: request, admin }, {
      tabela: "manut_cupons", id, idCol: "id", entidade: "manut_cupons",
      descricao: cupom ? `Excluiu cupom "${cupom.codigo}"` : `Excluiu cupom ${id}`,
    });
    if (!r.ok) return jsonErr(400, r.error || "Falha ao excluir");
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autorizado" ? 401 : 500, e.message);
  }
};
