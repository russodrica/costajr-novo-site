import type { APIRoute } from "astro";
import { requireAdminCookie, temPerfil, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";
import { registrarAcao } from "../../../../lib/auditoria";

export const prerender = false;
const PERFIS = ["admin"];

// PATCH → aprovar (com o texto final) ou descartar uma pergunta do ML.
//
// O envio em si é do robô (ml_perguntas, de hora em hora): o portal não
// guarda token do ML. Aqui só se registra a decisão dela. Regra de segurança
// espelhada no robô: texto com a marca [REVISAR...] não é aceito para
// aprovação — é o jeito de nunca publicar um rascunho incompleto.

export const PATCH: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");

    const body = await request.json().catch(() => ({}));
    const id = String(body.id || "");
    const acao = String(body.acao || "");
    const texto = String(body.texto || "").trim();
    if (!id) return jsonErr(400, "Falta o id da pergunta");
    if (!["aprovar", "descartar"].includes(acao)) return jsonErr(400, `Ação inválida: ${acao}`);

    const patch: Record<string, any> = { updated_at: new Date().toISOString() };
    if (acao === "aprovar") {
      if (!texto) return jsonErr(400, "A resposta está vazia");
      if (texto.includes("[REVISAR")) {
        return jsonErr(400, "O texto ainda tem a marca [REVISAR…] — complete a resposta e apague a marca antes de aprovar.");
      }
      patch.status = "aprovada";
      patch.resposta = texto.slice(0, 2000);
      patch.erro_envio = null;
    } else {
      patch.status = "descartada";
    }

    const db = supabaseAdmin();
    const { data, error } = await db
      .from("vendas_perguntas")
      .update(patch)
      .eq("id", id)
      .select("id, status")
      .single();
    if (error) return jsonErr(500, error.message);

    await registrarAcao(admin, `vendas_pergunta_${acao}`, { id });
    return jsonOk({ pergunta: data });
  } catch (e: any) {
    return jsonErr(500, e?.message || "Erro inesperado");
  }
};
