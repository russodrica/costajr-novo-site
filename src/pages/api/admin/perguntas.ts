import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../lib/auth";
import { supabaseAdmin } from "../../../lib/supabase";
import { pontuarEntrada, notificar } from "../../../lib/junia";

export const prerender = false;

// GET /api/admin/perguntas — pendentes + últimas respondidas
export const GET: APIRoute = async ({ request }) => {
  try {
    await requireAdminCookie(request);
    const sb = supabaseAdmin();
    const [{ data: pendentes }, { data: respondidas }] = await Promise.all([
      sb.from("portal_pending_questions").select("*").eq("status", "pending").order("created_at", { ascending: false }),
      sb.from("portal_pending_questions").select("*").eq("status", "answered").order("answered_at", { ascending: false }).limit(30),
    ]);
    return jsonOk({ pendentes: pendentes || [], respondidas: respondidas || [] });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// POST — responder pendência
// body: { id, resposta, adicionar_kb?, categoria? } | { id, acao: "ignorar" }
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const body = await request.json();
    const sb = supabaseAdmin();

    const { data: p } = await sb.from("portal_pending_questions").select("*").eq("id", body.id).maybeSingle();
    if (!p) return jsonErr(404, "Pergunta não encontrada");
    if (p.status !== "pending") return jsonErr(400, "Esta pergunta já foi tratada.");

    if (body.acao === "ignorar") {
      await sb.from("portal_pending_questions").update({ status: "ignored", answered_by: admin.email }).eq("id", p.id);
      return jsonOk({ ok: true });
    }

    const resposta = String(body.resposta || "").trim();
    if (!resposta) return jsonErr(400, "Escreva a resposta.");
    const categoria = body.categoria || p.category || "Geral";

    // 1. marca respondida
    await sb.from("portal_pending_questions").update({
      status: "answered", answer: resposta, answered_by: admin.email,
      answered_at: new Date().toISOString(), added_to_kb: !!body.adicionar_kb,
    }).eq("id", p.id);

    // 2. resposta entra na conversa de origem
    if (p.conversation_id) {
      await sb.from("portal_messages").insert({
        conversation_id: p.conversation_id, role: "assistant",
        content: `📢 **Resposta do gestor:**\n\nOlá! ${resposta}`,
        category: categoria, was_answered: true,
      });
      await sb.from("portal_conversations").update({ updated_at: new Date().toISOString() }).eq("id", p.conversation_id);
    }

    // 3. notifica o autor
    if (p.user_id) {
      await notificar(p.user_id, "resposta_disponivel", "🎉 Sua pergunta foi respondida!",
        `"${p.question.slice(0, 80)}${p.question.length > 80 ? "…" : ""}"`,
        p.conversation_id ? `/portal/junia?conversa=${p.conversation_id}` : "/portal/junia");
    }

    // 4. adiciona à base de conhecimento
    if (body.adicionar_kb) {
      await sb.from("portal_kb").insert({ question: p.question, answer: resposta, category: categoria, access_roles: ["all"], created_by: admin.email });

      // 5. re-análise: outras pendentes que a nova resposta cobre
      const { data: outras } = await sb.from("portal_pending_questions").select("*").eq("status", "pending").neq("id", p.id);
      let reaproveitadas = 0;
      for (const o of outras || []) {
        const score = pontuarEntrada(o.question, { question: p.question, answer: resposta });
        if (score >= 8) {
          await sb.from("portal_pending_questions").update({
            status: "answered", answer: resposta, answered_by: admin.email + " (auto)",
            answered_at: new Date().toISOString(), added_to_kb: false,
          }).eq("id", o.id);
          if (o.conversation_id) {
            await sb.from("portal_messages").insert({
              conversation_id: o.conversation_id, role: "assistant",
              content: `📢 **Nova resposta disponível!**\n\nOlá! ${resposta}`,
              category: categoria, was_answered: true,
            });
          }
          if (o.user_id) {
            await notificar(o.user_id, "resposta_disponivel", "🎉 Sua pergunta foi respondida!",
              `"${o.question.slice(0, 80)}"`,
              o.conversation_id ? `/portal/junia?conversa=${o.conversation_id}` : "/portal/junia");
          }
          reaproveitadas++;
        }
      }
      return jsonOk({ ok: true, adicionada_kb: true, pendentes_reaproveitadas: reaproveitadas });
    }

    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
