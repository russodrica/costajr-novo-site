import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";

export const prerender = false;

// GET /api/admin/fin/categorias — todas, ordenadas por tipo e nome
export const GET: APIRoute = async ({ request }) => {
  try {
    await requireAdminCookie(request);
    const db = supabaseAdmin();
    const { data, error } = await db.from("fin_categorias")
      .select("*")
      .order("tipo", { ascending: true })
      .order("nome", { ascending: true });
    if (error) return jsonErr(500, error.message);
    return jsonOk(data || []);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// POST /api/admin/fin/categorias — cria categoria
export const POST: APIRoute = async ({ request }) => {
  try {
    await requireAdminCookie(request);
    const body = await request.json();
    const { nome, tipo, cor } = body;
    if (!nome || !tipo) return jsonErr(400, "Nome e tipo são obrigatórios");
    if (!["receita", "despesa"].includes(tipo)) return jsonErr(400, "Tipo inválido");

    const row: Record<string, unknown> = { nome, tipo };
    if (cor) row.cor = cor;

    const db = supabaseAdmin();
    const { data, error } = await db.from("fin_categorias").insert(row).select().single();
    if (error) return jsonErr(400, error.message);
    return jsonOk(data, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
