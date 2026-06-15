import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { requireAdmin, jsonOk, jsonErr } from "~/lib/auth";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    const claims = await requireAdmin(request);
    const sb = supabaseAdmin();
    const { data } = await sb
      .from("portal_docs")
      .select("*")
      .or(`access_roles.cs.{all},access_roles.cs.{${claims.role}}`)
      .order("category")
      .order("created_at", { ascending: false });
    return jsonOk(data || []);
  } catch {
    return jsonErr(401, "Não autenticado.");
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const claims = await requireAdmin(request);
    if (!["admin", "rh"].includes(claims.role)) return jsonErr(403, "Sem permissão.");
    const body = await request.json();
    const { title, description, category, url, storage_path, access_roles } = body;
    if (!title) return jsonErr(400, "Título obrigatório.");
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("portal_docs")
      .insert({ title, description, category, url, storage_path, access_roles: access_roles || ["{all}"], uploaded_by: claims.sub })
      .select().single();
    if (error) return jsonErr(500, "Erro ao criar documento.");
    return jsonOk(data, 201);
  } catch {
    return jsonErr(401, "Não autenticado.");
  }
};
