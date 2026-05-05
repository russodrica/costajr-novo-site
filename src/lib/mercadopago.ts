// Mercado Pago — Subscriptions (preapproval) com pagamento pendente.
// Cliente é redirecionado para init_point e cadastra cartão lá.
// Webhook em /api/manut/mp_webhook ativa cliente quando autorizado.

const MP_API = "https://api.mercadopago.com";
const SITE = import.meta.env.SITE_BASE_URL || "https://costajr.com.br";

function token(): string {
  const t = import.meta.env.MP_ACCESS_TOKEN;
  if (!t) throw new Error("MP_ACCESS_TOKEN não configurado");
  return t;
}

export type CriarPreapprovalArgs = {
  cliente: { id: string; email: string };
  plano: { id: string; nome: string; valorMensal: number; valorCobranca?: number; duracaoMeses?: number };
  externalReference: string;
};

export type CriarPreapprovalResult = {
  ok: boolean;
  initPoint: string | null;
  preapprovalId: string | null;
  motivo?: string;
};

export async function criarPreapproval(args: CriarPreapprovalArgs): Promise<CriarPreapprovalResult> {
  const body = {
    reason: `CJR Manutencao - Plano ${args.plano.nome}`,
    external_reference: args.externalReference,
    payer_email: args.cliente.email,
    auto_recurring: {
      frequency: args.plano.duracaoMeses ?? 1,
      frequency_type: "months",
      transaction_amount: Number(args.plano.valorCobranca ?? args.plano.valorMensal),
      currency_id: "BRL"
    },
    back_url: `${SITE}/manutencao/contratar?status=ok&ref=${encodeURIComponent(args.externalReference)}`,
    status: "pending"
  };
  const res = await fetch(`${MP_API}/preapproval`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({} as any));
  console.log("[MP][preapproval] status:", res.status, "body:", JSON.stringify(data));
  if (!res.ok) {
    const motivo = (data as any).message || (data as any).error || JSON.stringify(data);
    return { ok: false, motivo, initPoint: null, preapprovalId: null };
  }
  return { ok: true, initPoint: (data as any).init_point, preapprovalId: (data as any).id };
}

export async function buscarPreapproval(id: string): Promise<any | null> {
  const res = await fetch(`${MP_API}/preapproval/${id}`, {
    headers: { Authorization: `Bearer ${token()}` }
  });
  if (!res.ok) return null;
  return res.json();
}
