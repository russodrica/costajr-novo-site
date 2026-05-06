import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { requireAdmin, jsonOk, jsonErr } from "~/lib/auth";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    const claims = await requireAdmin(request);
    if (!["admin", "coordenador", "comercial"].includes(claims.role)) return jsonErr(403, "Sem permissão.");
    const sb = supabaseAdmin();
    const { data } = await sb
      .from("manut_leads")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    return jsonOk(data || []);
  } catch {
    return jsonErr(401, "Não autenticado.");
  }
};

export const PATCH: APIRoute = async ({ request }) => {
  try {
    const claims = await requireAdmin(request);
    if (!["admin", "coordenador", "comercial"].includes(claims.role)) return jsonErr(403, "Sem permissão.");
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (!id) return jsonErr(400, "ID obrigatório.");
    const body = await request.json();
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("manut_leads")
      .update({ ...body, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select().single();
    if (error) return jsonErr(500, "Erro ao atualizar lead.");
    return jsonOk(data);
  } catch {
    return jsonErr(401, "Não autenticado.");
  }
};
