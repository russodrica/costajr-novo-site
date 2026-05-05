import type { APIRoute } from "astro";
import { requireAdmin, jsonOk, jsonErr, hashSenha, gerarSenhaInicial } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";

export const prerender = false;

export const PUT: APIRoute = async ({ request, params }) => {
  try {
    await requireAdmin(request);
    const { id } = params;
    if (!id) return jsonErr(400, "id obrigatório");

    const body = await request.json();
    const allowed = ["status", "nome", "telefone", "plano_selecionado", "valor_mensal_contratado", "visitas_contratadas", "data_proximo_vencimento"];
    const update: Record<string, any> = {};
    for (const k of allowed) {
      if (k in body) update[k] = body[k];
    }

    if (body.reset_senha) {
      const novaSenha = gerarSenhaInicial();
      update.senha_hash = await hashSenha(novaSenha);
      update.senha_troca_obrigatoria = true;
      const { error } = await supabaseAdmin().from("manut_clientes").update(update).eq("id", id);
      if (error) throw new Error(error.message);
      return jsonOk({ ok: true, novaSenha });
    }

    if (Object.keys(update).length === 0) return jsonErr(400, "Nenhum campo para atualizar");
    const { error } = await supabaseAdmin().from("manut_clientes").update(update).eq("id", id);
    if (error) throw new Error(error.message);
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autorizado" ? 401 : 500, e.message);
  }
};
