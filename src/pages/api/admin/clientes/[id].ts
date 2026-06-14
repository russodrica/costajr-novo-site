import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";
import { excluirComLixeira, registrarAcao } from "../../../../lib/auditoria";

export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const id = params.id!;
    const body = await request.json();
    const db = supabaseAdmin();
    const { data, error } = await db.from("manut_clientes").update(body).eq("id", id).select().single();
    if (error) return jsonErr(400, error.message);
    await registrarAcao(db, { req: request, admin }, { acao: "editar", entidade: "manut_clientes", registro_id: id, descricao: `Editou cliente "${data.nome}"`, dados: body });
    return jsonOk(data);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const id = params.id!;
    const db = supabaseAdmin();
    const { data: cli } = await db.from("manut_clientes").select("nome").eq("id", id).maybeSingle();
    const r = await excluirComLixeira(db, { req: request, admin }, {
      tabela: "manut_clientes", id, idCol: "id", entidade: "manut_clientes",
      descricao: cli ? `Excluiu cliente "${cli.nome}"` : `Excluiu cliente ${id}`,
    });
    if (!r.ok) return jsonErr(400, r.error || "Falha ao excluir");
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

export const POST: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const body = await request.json();
    if (body.action !== "delete") return jsonErr(400, "Ação inválida");
    const id = params.id!;
    const db = supabaseAdmin();
    const { data: cli } = await db.from("manut_clientes").select("nome").eq("id", id).maybeSingle();
    // Deleta dependentes em ordem (FK sem CASCADE)
    await db.from("manut_materiais").delete().eq("cliente_id", id);
    await db.from("manut_pagamentos").delete().eq("cliente_id", id);
    await db.from("manut_orcamentos").delete().eq("cliente_id", id);
    await db.from("manut_chamados").delete().eq("cliente_id", id);
    await db.from("manut_preventivas").delete().eq("cliente_id", id);
    // manut_lojas tem ON DELETE CASCADE, mas deletamos explicitamente para garantir
    await db.from("manut_lojas").delete().eq("cliente_id", id);
    // O cadastro do cliente vai para a lixeira (30 dias) e fica logado; os
    // dependentes acima são exclusão definitiva (cascata operacional).
    const r = await excluirComLixeira(db, { req: request, admin }, {
      tabela: "manut_clientes", id, idCol: "id", entidade: "manut_clientes",
      descricao: cli ? `Excluiu cliente "${cli.nome}" (com dependentes)` : `Excluiu cliente ${id} (com dependentes)`,
    });
    if (!r.ok) return jsonErr(400, r.error || "Falha ao excluir");
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

export const GET: APIRoute = async ({ request, params }) => {
  try {
    await requireAdminCookie(request);
    const db = supabaseAdmin();
    const { data, error } = await db.from("manut_clientes").select("*").eq("id", params.id!).single();
    if (error || !data) return jsonErr(404, "Cliente não encontrado");
    return jsonOk(data);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
