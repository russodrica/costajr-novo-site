import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";

export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    await requireAdminCookie(request);
    const body = await request.json();
    const db = supabaseAdmin();
    const { data, error } = await db.from("manut_clientes").update(body).eq("id", params.id!).select().single();
    if (error) return jsonErr(400, error.message);
    return jsonOk(data);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    await requireAdminCookie(request);
    const db = supabaseAdmin();
    const { error } = await db.from("manut_clientes").delete().eq("id", params.id!);
    if (error) return jsonErr(400, error.message);
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

export const POST: APIRoute = async ({ request, params }) => {
  try {
    await requireAdminCookie(request);
    const body = await request.json();
    if (body.action !== "delete") return jsonErr(400, "Ação inválida");
    const id = params.id!;
    const db = supabaseAdmin();
    // Deleta dependentes em ordem (FK sem CASCADE)
    await db.from("manut_materiais").delete().eq("cliente_id", id);
    await db.from("manut_pagamentos").delete().eq("cliente_id", id);
    await db.from("manut_orcamentos").delete().eq("cliente_id", id);
    await db.from("manut_chamados").delete().eq("cliente_id", id);
    await db.from("manut_preventivas").delete().eq("cliente_id", id);
    // manut_lojas tem ON DELETE CASCADE, mas deletamos explicitamente para garantir
    await db.from("manut_lojas").delete().eq("cliente_id", id);
    const { error } = await db.from("manut_clientes").delete().eq("id", id);
    if (error) return jsonErr(400, error.message);
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
