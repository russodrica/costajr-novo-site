import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { requireAdmin, jsonOk, jsonErr } from "~/lib/auth";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    await requireAdmin(request);
    const url = new URL(request.url);
    const categoria = url.searchParams.get("categoria");
    const sb = supabaseAdmin();
    let q = sb
      .from("portal_forum_topicos")
      .select("id, titulo, categoria, autor_nome, fixado, fechado, views, respostas_count, created_at")
      .order("fixado", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(50);
    if (categoria) q = q.eq("categoria", categoria);
    const { data } = await q;
    return jsonOk(data || []);
  } catch {
    return jsonErr(401, "Não autenticado.");
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const claims = await requireAdmin(request);
    const { titulo, categoria, conteudo } = await request.json();
    if (!titulo || !conteudo) return jsonErr(400, "Campos obrigatórios ausentes.");
    const userData = { nome: claims.email };
    const sb = supabaseAdmin();
    const { data: profile } = await sb.from("portal_profiles").select("full_name, display_name").eq("id", claims.sub).single();
    const autor_nome = profile?.full_name || profile?.display_name || claims.email;
    const { data, error } = await sb
      .from("portal_forum_topicos")
      .insert({ titulo, categoria: categoria || "geral", conteudo, autor_id: claims.sub, autor_nome })
      .select().single();
    if (error) return jsonErr(500, "Erro ao criar tópico.");
    return jsonOk(data, 201);
  } catch {
    return jsonErr(401, "Não autenticado.");
  }
};
