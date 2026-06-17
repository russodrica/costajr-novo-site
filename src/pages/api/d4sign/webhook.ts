import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { jsonOk } from "~/lib/auth";

export const prerender = false;

// POST /api/d4sign/webhook — a D4Sign chama a cada evento do documento.
// Payload (form ou json): uuid (do documento), type_post (1=finalizado,
// 2=email, 3=visualizado, 4=cancelado...). Atualizamos o termo vinculado.
//
// SEGURANÇA: sem verificação, qualquer um que saiba um d4sign_uuid poderia POSTar
// {uuid, type_post:1} e forjar "termo assinado". Exigimos um segredo compartilhado
// (header x-d4sign-secret OU ?key= na URL do webhook configurada no painel D4Sign).
// Rollout gradual: só passa a EXIGIR quando D4SIGN_WEBHOOK_SECRET estiver definido —
// assim o webhook atual não quebra antes de você configurar o segredo na D4Sign.
const WEBHOOK_SECRET = import.meta.env.D4SIGN_WEBHOOK_SECRET || process.env.D4SIGN_WEBHOOK_SECRET || "";

export const POST: APIRoute = async ({ request, url }) => {
  try {
    if (WEBHOOK_SECRET) {
      const recebido = request.headers.get("x-d4sign-secret") || url.searchParams.get("key") || "";
      if (recebido !== WEBHOOK_SECRET) {
        return new Response(JSON.stringify({ ok: false, error: "não autorizado" }), { status: 401, headers: { "content-type": "application/json" } });
      }
    }
    let dados: Record<string, string> = {};
    const ct = request.headers.get("content-type") || "";
    if (ct.includes("json")) dados = await request.json();
    else dados = Object.fromEntries((await request.formData()).entries()) as Record<string, string>;

    const uuid = dados.uuid || dados.uuidDoc || "";
    if (!uuid) return jsonOk({ ok: true, ignorado: "sem uuid" });

    const tipo = String(dados.type_post || dados.typePost || "");
    const db = supabaseAdmin();

    const patch: Record<string, unknown> = {};
    if (tipo === "1") { patch.d4sign_status = "4"; patch.d4sign_finalizado_em = new Date().toISOString(); }
    else if (tipo === "4") { patch.d4sign_status = "6"; }
    else return jsonOk({ ok: true, ignorado: `type_post ${tipo}` });

    const { data: termo } = await db.from("ativos_termos").update(patch).eq("d4sign_uuid", uuid).select("id, ativo_id, colaborador_nome").maybeSingle();
    if (termo && tipo === "1") {
      await db.from("ativos_termos").update({ status: "aceito", aceito_em: new Date().toISOString() }).eq("id", termo.id).eq("status", "pendente");
      await db.from("ativos_movimentos").insert({
        ativo_id: termo.ativo_id,
        tipo: "mudanca_status",
        descricao: `Termo de responsabilidade assinado via D4Sign por ${termo.colaborador_nome}`,
        dados: { d4sign_uuid: uuid },
        feito_por: "d4sign-webhook",
      });
    }
    return jsonOk({ ok: true });
  } catch {
    // webhook nunca deve retornar erro 5xx em cascata
    return jsonOk({ ok: false });
  }
};
