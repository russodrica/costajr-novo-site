import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { requireAdmin, jsonOk, jsonErr } from "~/lib/auth";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    const claims = await requireAdmin(request);
    const sb = supabaseAdmin();
    const { data } = await sb
      .from("portal_onboarding_steps")
      .select("*")
      .or(`access_roles.cs.{all},access_roles.cs.{${claims.role}}`)
      .order("ordem");
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
    const { titulo, conteudo, tipo, url_recurso, access_roles, ordem, obrigatorio } = body;
    if (!titulo || !conteudo) return jsonErr(400, "Campos obrigatórios ausentes.");
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("portal_onboarding_steps")
      .insert({ titulo, conteudo, tipo: tipo || "texto", url_recurso, access_roles: access_roles || ["{all}"], ordem: ordem || 0, obrigatorio: obrigatorio !== false })
      .select().single();
    if (error) return jsonErr(500, "Erro ao criar etapa.");
    return jsonOk(data, 201);
  } catch {
    return jsonErr(401, "Não autenticado.");
  }
};
