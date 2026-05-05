import { supabaseAdmin } from "../supabase";
import { buscarPreapproval } from "../mercadopago";

const db = () => supabaseAdmin();

export async function processarMpWebhook(payload: {
  tipo?: string; recursoId?: string; externalReference?: string;
}) {
  const { tipo, recursoId, externalReference } = payload;
  if (!recursoId && !externalReference) return { ok: true, ignored: true };

  let preapprovalId = recursoId;
  let pre = preapprovalId ? await buscarPreapproval(preapprovalId) : null;

  if (!pre && externalReference) {
    // Tenta achar via external_reference (formato CJR-MANUT-<clienteId>-<pagamentoId>)
    const partes = externalReference.split("-");
    if (partes[3]) {
      const { data: pag } = await db()
        .from("manut_pagamentos")
        .select("mercado_pago_id")
        .eq("id", partes[3])
        .maybeSingle();
      if (pag?.mercado_pago_id) {
        preapprovalId = pag.mercado_pago_id;
        pre = await buscarPreapproval(preapprovalId);
      }
    }
  }
  if (!pre) return { ok: true, encontrado: false };

  const ref = pre.external_reference || externalReference || "";
  const partes = ref.split("-"); // CJR-MANUT-<clienteId>-<pagamentoId>
  const clienteId = partes[2];
  const pagamentoId = partes[3];

  // Atualiza pagamento
  if (pagamentoId) {
    const updates: any = { mercado_pago_id: preapprovalId };
    if (pre.status === "authorized") {
      updates.status = "pago";
      updates.data_pagamento = new Date().toISOString();
    } else if (pre.status === "cancelled") {
      updates.status = "cancelado";
    }
    await db().from("manut_pagamentos").update(updates).eq("id", pagamentoId);
  }

  // Ativa cliente quando autorizado
  if (clienteId && pre.status === "authorized") {
    await db()
      .from("manut_clientes")
      .update({
        status: "ativo",
        data_proximo_vencimento: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      })
      .eq("id", clienteId)
      .neq("status", "ativo");
    await db()
      .from("manut_lojas")
      .update({ status: "ativa" })
      .eq("cliente_id", clienteId)
      .eq("status", "pendente");
  }

  return { ok: true, status: pre.status };
}
