import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { requireAdmin, jsonOk, jsonErr } from "~/lib/auth";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    await requireAdmin(request);
    const url = new URL(request.url);
    const topico_id = url.searchParams.get("topico_id");
    if (!topico_id) return jsonErr(400, "topico_id obrigatório.");
    const sb = supabaseAdmin();
    const { data } = await sb
      .from("portal_forum_respostas")
      .select("*")
      .eq("topico_id", topico_id)
      .order("melhor_resposta", { ascending: false })
      .order("created_at");
    return jsonOk(data || []);
  } catch {
    return jsonErr(401, "Não autenticado.");
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const claims = await requireAdmin(request);
    const { topico_id, conteudo } = await request.json();
    if (!topico_id || !conteudo) return jsonErr(400, "Campos obrigatórios ausentes.");
    const sb = supabaseAdmin();

    const { data: topico } = await sb.from("portal_forum_topicos").select("fechado, respostas_count").eq("id", topico_id).single();
    if (topico?.fechado) return jsonErr(403, "Tópico fechado.");

    const { data: profile } = await sb.from("portal_profiles").select("full_name, display_name").eq("id", claims.sub).single();
    const autor_nome = profile?.full_name || profile?.display_name || claims.email;

    const { data, error } = await sb
      .from("portal_forum_respostas")
      .insert({ topico_id, conteudo, autor_id: claims.sub, autor_nome })
      .select().single();
    if (error) return jsonErr(500, "Erro ao postar resposta.");

    // Atualiza contador e updated_at do tópico
    await sb.from("portal_forum_topicos").update({
      respostas_count: (topico?.respostas_count || 0) + 1,
      updated_at: new Date().toISOString(),
    }).eq("id", topico_id);

    return jsonOk(data, 201);
  } catch {
    return jsonErr(401, "Não autenticado.");
  }
};
