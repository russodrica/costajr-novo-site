import type { APIRoute } from "astro";
import { requireCliente, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";
import { criarPagamentoPix } from "~/lib/mercadopago";

export const prerender = false;

// POST /api/manut/cliente/materiais/[id]/pagamento
// Gera (ou reusa) um Pix do Mercado Pago para o material.
// Resposta: { qr_code, qr_code_base64, ticket_url, payment_id, reused }
export const POST: APIRoute = async ({ request, params }) => {
  try {
    const claims = await requireCliente(request);
    const id = params.id!;
    const db = supabaseAdmin();

    const { data: mat } = await db
      .from("manut_materiais")
      .select("*, manut_clientes(nome,email,cnpj_cpf)")
      .eq("id", id)
      .single();
    if (!mat) return jsonErr(404, "Material não encontrado");
    if (mat.cliente_id !== claims.sub) return jsonErr(403, "Material não pertence a você");

    // Reusa o Pix já gerado, se existir
    if (mat.mercado_pago_pix && (mat.mercado_pago_pix as any).qr_code) {
      const pix = mat.mercado_pago_pix as any;
      return jsonOk({
        qr_code: pix.qr_code,
        qr_code_base64: pix.qr_code_base64,
        ticket_url: pix.ticket_url,
        payment_id: pix.payment_id,
        reused: true,
      });
    }

    const cli = mat.manut_clientes as any;
    const result = await criarPagamentoPix({
      cliente: {
        email: cli?.email || claims.email || "comprador@costajr.com.br",
        nome: cli?.nome || "Cliente",
        cnpjCpf: cli?.cnpj_cpf,
      },
      material: {
        id: mat.id,
        descricao: mat.descricao,
        valor: Number(mat.valor),
      },
    });
    if (!result.ok) return jsonErr(400, "Falha ao gerar Pix: " + result.motivo);

    const pix = {
      payment_id: result.paymentId,
      qr_code: result.qrCode,
      qr_code_base64: result.qrCodeBase64,
      ticket_url: result.ticketUrl,
      gerado_em: new Date().toISOString(),
    };
    await db
      .from("manut_materiais")
      .update({ mercado_pago_pix: pix })
      .eq("id", id);

    return jsonOk({ ...pix, reused: false });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" || e.message === "Token inválido" ? 401 : 500, e.message);
  }
};
