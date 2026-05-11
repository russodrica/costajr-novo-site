import { supabaseAdmin } from "../supabase";
import { buscarPreapproval, buscarPayment } from "../mercadopago";

const db = () => supabaseAdmin();

// UUIDs contêm dashes — extrair por regex em vez de split("-")
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function parseRef(ref: string): { clienteId?: string; pagamentoId?: string; isLink: boolean } {
  const ids = [...ref.matchAll(new RegExp(UUID_RE.source, "gi"))].map(m => m[0]);
  const isLink = ref.includes("LINK");
  return {
    clienteId: ids[0],
    pagamentoId: isLink ? undefined : ids[1],
    isLink
  };
}

async function ativarCliente(clienteId?: string, pagamentoId?: string, mpId?: string) {
  if (!clienteId) return;
  console.log("[webhook] ativando cliente", clienteId);

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

  if (pagamentoId) {
    await db()
      .from("manut_pagamentos")
      .update({
        status: "pago",
        data_pagamento: new Date().toISOString(),
        ...(mpId ? { mercado_pago_id: mpId } : {})
      })
      .eq("id", pagamentoId)
      .neq("status", "pago");
  }
}

export async function processarMpWebhook(payload: {
  tipo?: string; recursoId?: string; externalReference?: string;
}) {
  const { tipo, recursoId, externalReference } = payload;
  console.log("[webhook] recebido:", { tipo, recursoId, externalReference });

  if (!recursoId && !externalReference) return { ok: true, ignored: true };

  // ─── Checkout Pro / Pix: evento "payment" ────────────────────────────────
  if (tipo === "payment" && recursoId) {
    const pmt = await buscarPayment(recursoId);
    console.log("[webhook][payment]", JSON.stringify(pmt));
    if (!pmt) return { ok: true, encontrado: false };

    const ref: string = pmt.external_reference || externalReference || "";

    // Material aprovado pelo cliente — Pix gerado por /v1/payments
    if (ref.startsWith("CJR-MAT-")) {
      const materialId = ref.replace(/^CJR-MAT-/, "");
      console.log("[webhook][material]", materialId, "status:", pmt.status);
      const updates: any = {};
      if (pmt.status === "approved") {
        updates.status = "pago";
        updates.pago_em = new Date().toISOString();
      } else if (pmt.status === "cancelled" || pmt.status === "rejected") {
        // mantém status atual; só registra o que aconteceu se quisermos
      }
      if (Object.keys(updates).length) {
        await db()
          .from("manut_materiais")
          .update(updates)
          .eq("id", materialId)
          .neq("status", "pago");
      }
      return { ok: true, status: pmt.status, materialId };
    }

    if (!ref.startsWith("CJR-MANUT")) return { ok: true, ignored: true, ref };

    if (pmt.status === "approved") {
      const { clienteId, pagamentoId } = parseRef(ref);
      await ativarCliente(clienteId, pagamentoId, recursoId);
      return { ok: true, status: "approved", clienteId };
    }
    return { ok: true, status: pmt.status };
  }

  // ─── Preapproval (assinatura recorrente) ─────────────────────────────────
  let preapprovalId = recursoId;
  let pre = preapprovalId ? await buscarPreapproval(preapprovalId) : null;

  // Fallback: buscar pelo external_reference caso recursoId não retorne dados
  if (!pre && externalReference) {
    const { pagamentoId } = parseRef(externalReference);
    if (pagamentoId) {
      const { data: pag } = await db()
        .from("manut_pagamentos")
        .select("mercado_pago_id")
        .eq("id", pagamentoId)
        .maybeSingle();
      if (pag?.mercado_pago_id) {
        preapprovalId = pag.mercado_pago_id;
        pre = await buscarPreapproval(preapprovalId!);
      }
    }
  }

  if (!pre) {
    console.log("[webhook] preapproval não encontrado", { preapprovalId, externalReference });
    return { ok: true, encontrado: false };
  }

  console.log("[webhook][preapproval] status:", pre.status, "ref:", pre.external_reference);

  const ref: string = pre.external_reference || externalReference || "";
  const { clienteId, pagamentoId } = parseRef(ref);

  // Atualiza pagamento
  if (pagamentoId) {
    const upd: any = { mercado_pago_id: preapprovalId };
    if (pre.status === "authorized") {
      upd.status = "pago";
      upd.data_pagamento = new Date().toISOString();
    } else if (pre.status === "cancelled") {
      upd.status = "cancelado";
    }
    await db().from("manut_pagamentos").update(upd).eq("id", pagamentoId);
  }

  if (clienteId && pre.status === "authorized") {
    await ativarCliente(clienteId, pagamentoId, preapprovalId);
  }

  return { ok: true, status: pre.status, clienteId };
}
