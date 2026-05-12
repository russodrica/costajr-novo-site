import type { APIRoute } from "astro";
import { requireCliente, jsonOk, jsonErr } from "~/lib/auth";
import { gerarPixChamado } from "~/lib/manut/chamados";

export const prerender = false;

export const POST: APIRoute = async ({ request, params }) => {
  try {
    const claims = await requireCliente(request);
    const chamadoId = String(params.id);
    if (!chamadoId) return jsonErr(400, "chamado_id obrigatório");
    const { pix } = await gerarPixChamado(chamadoId, claims.sub);
    return jsonOk({ qrCode: pix.qrCode, qrCodeBase64: pix.qrCodeBase64, ticketUrl: pix.ticketUrl, paymentId: pix.paymentId });
  } catch (e: any) {
    return jsonErr(400, e.message);
  }
};
