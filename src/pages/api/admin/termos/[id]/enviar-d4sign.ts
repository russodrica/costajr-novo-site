import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { d4signConfigurado, listarCofres, uploadPdf, criarListaSignatarios, enviarParaAssinatura, registrarWebhook } from "../../../../../lib/d4sign";
import { gerarTermoPdf } from "../../../../../lib/termoPdf";

export const prerender = false;

// POST /api/admin/termos/[id]/enviar-d4sign
// Gera o PDF do termo, sobe no cofre da D4Sign e envia para o e-mail do
// colaborador assinar. body: { cofre_uuid? }
export const POST: APIRoute = async ({ request, params, url }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!d4signConfigurado()) {
      return jsonErr(400, "D4Sign não configurada. Defina D4SIGN_TOKEN no ambiente (o token fica no menu Dev API do painel D4Sign — se estiver vazio, peça a ativação da API ao suporte da D4Sign).");
    }
    const db = supabaseAdmin();

    const { data: termo } = await db.from("ativos_termos").select("*").eq("id", params.id!).maybeSingle();
    if (!termo) return jsonErr(404, "Termo não encontrado");
    if (!termo.colaborador_email) return jsonErr(400, "O termo não tem e-mail do colaborador — edite o cadastro do membro e gere o termo novamente.");
    if (termo.d4sign_uuid) return jsonErr(400, "Este termo já foi enviado para a D4Sign.");

    const body = await request.json().catch(() => ({}));
    let cofre = body.cofre_uuid || import.meta.env.D4SIGN_COFRE_UUID;
    if (!cofre) {
      const cofres = await listarCofres();
      if (!cofres.length) return jsonErr(400, "Nenhum cofre encontrado na conta D4Sign.");
      cofre = cofres[0].uuid_safe;
    }

    // PDF do termo
    const pdf = await gerarTermoPdf(termo.conteudo, "Termo de Responsabilidade de Uso de Equipamento");
    const nomeArquivo = `Termo - ${termo.colaborador_nome}.pdf`.replace(/[\\/:*?"<>|]/g, "-");
    const uuidDoc = await uploadPdf(cofre, nomeArquivo, Buffer.from(pdf).toString("base64"));

    // Signatário + envio
    await criarListaSignatarios(uuidDoc, [{ email: termo.colaborador_email, nome: termo.colaborador_nome }]);
    await enviarParaAssinatura(uuidDoc, `Olá ${termo.colaborador_nome}, você recebeu o termo de responsabilidade de equipamento da Costa Júnior para assinatura.`);

    // Webhook de status (melhor esforço — não falha o envio)
    try {
      const base = import.meta.env.SITE_BASE_URL || `${url.protocol}//${url.host}`;
      await registrarWebhook(uuidDoc, `${base}/api/d4sign/webhook`);
    } catch { /* webhook é opcional */ }

    const { data: atualizado, error } = await db.from("ativos_termos").update({
      d4sign_uuid: uuidDoc,
      d4sign_status: "3",
      d4sign_enviado_em: new Date().toISOString(),
    }).eq("id", termo.id).select().single();
    if (error) return jsonErr(400, error.message);

    await db.from("ativos_movimentos").insert({
      ativo_id: termo.ativo_id,
      tipo: "mudanca_status",
      descricao: `Termo de responsabilidade enviado para assinatura via D4Sign (${termo.colaborador_email})`,
      dados: { termo_id: termo.id, d4sign_uuid: uuidDoc },
      feito_por: admin.email,
    });

    return jsonOk(atualizado);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
