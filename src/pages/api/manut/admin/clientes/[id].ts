import type { APIRoute } from "astro";
import { requireAdmin, jsonOk, jsonErr, hashSenha, gerarSenhaInicial } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";
import { excluirComLixeira } from "~/lib/auditoria";

export const prerender = false;

async function gerarPreventivas(clienteId: string, visitas: number, dataBase: Date) {
  const db = supabaseAdmin();

  // Só gera se ainda não há preventivas para este cliente
  const { data: existing } = await db
    .from("manut_preventivas")
    .select("id")
    .eq("cliente_id", clienteId)
    .limit(1);
  if (existing && existing.length > 0) return;

  const total = Math.max(1, Math.min(visitas || 1, 60)); // sanity cap
  const rows: Record<string, any>[] = [];
  let data = new Date(dataBase);
  data.setDate(data.getDate() + 10); // primeira: +10 dias

  for (let i = 0; i < total; i++) {
    rows.push({
      cliente_id: clienteId,
      status: "agendada",
      data_agendada: data.toISOString().slice(0, 10),
    });
    data = new Date(data);
    data.setDate(data.getDate() + 30); // próximas: +30 dias
  }

  await db.from("manut_preventivas").insert(rows);
}

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

    const db = supabaseAdmin();

    // Busca dados atuais antes de atualizar (para saber visitas e status anterior)
    const { data: clienteAtual } = await db
      .from("manut_clientes")
      .select("status, visitas_contratadas")
      .eq("id", id)
      .single();

    const { error } = await db.from("manut_clientes").update(update).eq("id", id);
    if (error) throw new Error(error.message);

    if (body.status === "ativo") {
      // Ativa lojas pendentes
      await db.from("manut_lojas").update({ status: "ativa" }).eq("cliente_id", id).eq("status", "pendente");

      // Gera preventivas automáticas se cliente estava pendente antes
      const estavaPendente = clienteAtual && clienteAtual.status !== "ativo";
      if (estavaPendente) {
        const visitas = Number(body.visitas_contratadas || clienteAtual?.visitas_contratadas || 1);
        await gerarPreventivas(id, visitas, new Date());
      }
    }

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
    const { data: cliente } = await db.from("manut_clientes").select("nome").eq("id", id).maybeSingle();
    const r = await excluirComLixeira(db, { req: request, admin }, {
      tabela: "manut_clientes", id, idCol: "id", entidade: "manut_clientes",
      descricao: cliente ? `Excluiu cliente "${cliente.nome}"` : `Excluiu cliente ${id}`,
    });
    if (!r.ok) return jsonErr(400, r.error || "Falha ao excluir");
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autorizado" ? 401 : 500, e.message);
  }
};
