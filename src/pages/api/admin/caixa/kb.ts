import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";
import { registrarAcao } from "~/lib/auditoria";
import { bloqueioSeSoLeitura } from "~/lib/permissoes";

export const prerender = false;

// POST { pergunta, resposta, categoria } → adiciona à base de conhecimento (portal_kb).
// Entra na hora na JunIA (Fórum). Origem: Caixa de Entrada.
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const _ro = await bloqueioSeSoLeitura(admin, "caixa-entrada"); if (_ro) return _ro;
    const b = await request.json().catch(() => ({}));
    const question = String(b.pergunta || "").trim();
    const answer = String(b.resposta || "").trim();
    const category = String(b.categoria || "Geral").trim() || "Geral";
    if (!question || !answer) return jsonErr(400, "Preencha a pergunta e a resposta.");
    if (question.length > 500) return jsonErr(400, "Pergunta muito longa (máx. 500).");

    const db = supabaseAdmin();
    const { data, error } = await db.from("portal_kb").insert({ question, answer, category }).select().single();
    if (error) return jsonErr(400, error.message);
    await registrarAcao(db, { req: request, admin }, {
      acao: "criar", entidade: "portal_kb", registro_id: data?.id ?? null,
      descricao: `Caixa de Entrada: adicionou à base "${question.slice(0, 80)}"`, dados: { category },
    });
    return jsonOk(data, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
