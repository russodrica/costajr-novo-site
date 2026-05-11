import type { APIRoute } from "astro";
import { requireCliente, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";
import { solicitarReposicao, solicitarReposicaoProximaVisita, registrarPixReposicao } from "~/lib/manut/estoque";
import { criarPagamentoPixReposicao } from "~/lib/mercadopago";

export const prerender = false;

// POST /api/manut/cliente/estoque/movimentos/[id]
// Body: { action: "solicitar" }                           — apenas marca como solicitada
//       { action: "proxima_visita" }                      — vai comprar até a próxima preventiva
//       { action: "pagar_pix" }                           — gera Pix; retorna { qr_code, qr_code_base64, ticket_url }
export const POST: APIRoute = async ({ request, params }) => {
  try {
    const claims = await requireCliente(request);
    const body = await request.json();
    const movId = params.id!;

    // Autorização — movimento precisa ser de uma loja do cliente
    const db = supabaseAdmin();
    const { data: mov } = await db
      .from("manut_estoque_movimentos")
      .select("id,loja_id,quantidade,reposicao_status,reposicao_mp_pix,manut_estoque(nome,unidade,preco_unitario),manut_lojas(cliente_id)")
      .eq("id", movId)
      .single();
    if (!mov || (mov.manut_lojas as any)?.cliente_id !== claims.sub) {
      return jsonErr(403, "Movimento não pertence a você");
    }

    if (body.action === "solicitar") {
      const result = await solicitarReposicao(movId);
      return jsonOk(result);
    }

    if (body.action === "proxima_visita") {
      const result = await solicitarReposicaoProximaVisita(movId);
      return jsonOk(result);
    }

    if (body.action === "pagar_pix") {
      // Reusa Pix se já gerado
      const existente = (mov.reposicao_mp_pix as any);
      if (existente?.qr_code) {
        return jsonOk({ ...existente, reused: true });
      }
      const preco = Number((mov.manut_estoque as any)?.preco_unitario || 0);
      const valor = preco * Number(mov.quantidade);
      if (!preco || valor <= 0) {
        return jsonErr(400, "Item sem preço unitário cadastrado — defina o valor antes de pagar via Pix.");
      }
      // Dados do cliente
      const { data: cli } = await db
        .from("manut_clientes")
        .select("nome,email,cnpj_cpf")
        .eq("id", claims.sub)
        .single();
      const res = await criarPagamentoPixReposicao({
        cliente: {
          email: cli?.email || claims.email || "comprador@costajr.com.br",
          nome: cli?.nome || "Cliente",
          cnpjCpf: cli?.cnpj_cpf,
        },
        movimento: {
          id: movId,
          nomeItem: (mov.manut_estoque as any)?.nome || "Item",
          quantidade: Number(mov.quantidade),
          valor,
        },
      });
      if (!res.ok) return jsonErr(400, "Falha ao gerar Pix: " + res.motivo);

      const pix = {
        payment_id: res.paymentId,
        qr_code: res.qrCode,
        qr_code_base64: res.qrCodeBase64,
        ticket_url: res.ticketUrl,
        gerado_em: new Date().toISOString(),
      };
      await registrarPixReposicao(movId, pix, valor);
      return jsonOk({ ...pix, valor, reused: false });
    }

    return jsonErr(400, "action inválida");
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" || e.message === "Token inválido" ? 401 : 500, e.message);
  }
};
