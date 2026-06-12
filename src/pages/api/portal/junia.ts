import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { requireAdmin, jsonOk, jsonErr } from "~/lib/auth";
import { exigirArea } from "~/lib/permissoes";
import { responderJunIA } from "~/lib/junia";

export const prerender = false;

// GET /api/portal/junia            → lista de conversas do usuário
// GET /api/portal/junia?conversa=X → mensagens da conversa
export const GET: APIRoute = async ({ request, url }) => {
  try {
    const claims = await requireAdmin(request);
    try { await exigirArea(claims, "forum"); } catch (e: any) { return jsonErr(403, e.message); }
    const sb = supabaseAdmin();
    const conversaId = url.searchParams.get("conversa");
    if (conversaId) {
      const { data: conversa } = await sb.from("portal_conversations").select("id, user_id").eq("id", conversaId).maybeSingle();
      if (!conversa || conversa.user_id !== claims.sub) return jsonErr(403, "Conversa não encontrada.");
      const { data } = await sb.from("portal_messages").select("id, role, content, category, was_answered, created_at").eq("conversation_id", conversaId).order("created_at");
      return jsonOk(data || []);
    }
    const { data } = await sb.from("portal_conversations").select("id, title, updated_at").eq("user_id", claims.sub).order("updated_at", { ascending: false }).limit(50);
    return jsonOk(data || []);
  } catch {
    return jsonErr(401, "Não autenticado.");
  }
};

// POST { conversa_id?, pergunta } → responde via JunIA
export const POST: APIRoute = async ({ request }) => {
  try {
    const claims = await requireAdmin(request);
    try { await exigirArea(claims, "forum"); } catch (e: any) { return jsonErr(403, e.message); }
    const { conversa_id, pergunta } = await request.json();
    const texto = String(pergunta || "").trim();
    if (!texto) return jsonErr(400, "Escreva a sua pergunta.");
    if (texto.length > 2000) return jsonErr(400, "Pergunta muito longa.");
    const sb = supabaseAdmin();

    // conversa (cria se necessário)
    let convId = conversa_id;
    if (convId) {
      const { data: c } = await sb.from("portal_conversations").select("id, user_id").eq("id", convId).maybeSingle();
      if (!c || c.user_id !== claims.sub) return jsonErr(403, "Conversa inválida.");
    } else {
      const { data: c, error } = await sb.from("portal_conversations").insert({
        user_id: claims.sub,
        title: texto.slice(0, 60) + (texto.length > 60 ? "…" : ""),
      }).select("id").single();
      if (error) return jsonErr(500, error.message);
      convId = c.id;
    }

    await sb.from("portal_messages").insert({ conversation_id: convId, role: "user", content: texto });

    const r = await responderJunIA(claims, texto);

    const { data: msgIA } = await sb.from("portal_messages").insert({
      conversation_id: convId, role: "assistant", content: r.resposta,
      category: r.categoria, was_answered: !r.precisaResposta,
    }).select("id").single();

    if (r.precisaResposta) {
      await sb.from("portal_pending_questions").insert({
        user_id: claims.sub,
        user_name: claims.email,
        question: texto,
        category: r.categoria,
        conversation_id: convId,
      });
    }

    await sb.from("portal_conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId);
    return jsonOk({ conversa_id: convId, mensagem_id: msgIA?.id, resposta: r.resposta, categoria: r.categoria, precisa_resposta: r.precisaResposta, fonte: r.fonte });
  } catch {
    return jsonErr(401, "Não autenticado.");
  }
};
