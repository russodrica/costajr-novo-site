import type { APIRoute } from "astro";
import { requireAdmin, jsonOk, jsonErr, hashSenha, gerarSenhaInicial } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";
import { excluirComLixeira, registrarAcao } from "~/lib/auditoria";

export const prerender = false;

export const PUT: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdmin(request);
    const { id } = params;
    if (!id) return jsonErr(400, "id obrigatório");

    const body = await request.json();
    const allowed = ["nome", "email", "telefone", "cpf", "especialidades", "status", "lojas_ids"];
    const update: Record<string, any> = {};
    for (const k of allowed) {
      if (k in body) update[k] = body[k];
    }

    const db = supabaseAdmin();

    if (body.reset_senha) {
      const novaSenha = gerarSenhaInicial();
      update.senha_hash = await hashSenha(novaSenha);
      update.senha_troca_obrigatoria = true;
      const { error } = await db.from("manut_tecnicos").update(update).eq("id", id);
      if (error) throw new Error(error.message);
      await registrarAcao(db, { req: request, admin }, { acao: "editar", entidade: "manut_tecnicos", registro_id: id, descricao: `Resetou senha do técnico ${id}` });
      return jsonOk({ ok: true, novaSenha });
    }

    if (Object.keys(update).length === 0) return jsonErr(400, "Nenhum campo para atualizar");
    const { error } = await db.from("manut_tecnicos").update(update).eq("id", id);
    if (error) throw new Error(error.message);
    await registrarAcao(db, { req: request, admin }, { acao: "editar", entidade: "manut_tecnicos", registro_id: id, descricao: `Editou técnico ${id}`, dados: update });
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
    const { data: tec } = await db.from("manut_tecnicos").select("nome").eq("id", id).maybeSingle();
    const r = await excluirComLixeira(db, { req: request, admin }, {
      tabela: "manut_tecnicos", id, idCol: "id", entidade: "manut_tecnicos",
      descricao: tec ? `Excluiu técnico "${tec.nome}"` : `Excluiu técnico ${id}`,
    });
    if (!r.ok) return jsonErr(400, r.error || "Falha ao excluir");
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autorizado" ? 401 : 500, e.message);
  }
};
