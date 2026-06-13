import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";

export const prerender = false;

// GET — anotações da obra (mais recentes primeiro)
export const GET: APIRoute = async ({ request, params }) => {
  try {
    await requireAdminCookie(request);
    const db = supabaseAdmin();
    const { data, error } = await db
      .from("obras_anotacoes").select("*")
      .eq("obra_id", params.id!)
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) return jsonErr(500, error.message);
    return jsonOk(data || []);
  } catch (e: any) { return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message); }
};

// POST — nova anotação
export const POST: APIRoute = async ({ request, params }) => {
  try {
    const claims = await requireAdminCookie(request);
    const b = await request.json();
    if (!b.texto?.trim()) return jsonErr(400, "Escreva a anotação.");
    const db = supabaseAdmin();
    const { data, error } = await db.from("obras_anotacoes").insert({
      obra_id: params.id!,
      texto: b.texto.trim(),
      criado_por: claims.email || claims.sub,
    }).select().single();
    if (error) return jsonErr(500, error.message);
    return jsonOk(data, 201);
  } catch (e: any) { return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message); }
};

// DELETE ?anotacao=ID
export const DELETE: APIRoute = async ({ request, params, url }) => {
  try {
    await requireAdminCookie(request);
    const anotId = url.searchParams.get("anotacao");
    if (!anotId) return jsonErr(400, "Informe ?anotacao=ID.");
    const db = supabaseAdmin();
    const { error } = await db.from("obras_anotacoes").delete().eq("id", anotId).eq("obra_id", params.id!);
    if (error) return jsonErr(500, error.message);
    return jsonOk({ ok: true });
  } catch (e: any) { return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message); }
};
