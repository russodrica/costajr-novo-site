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

// Checkout Pro — pagamento único sem exigir conta MP (funciona com cartão/pix/boleto)
export async function criarPreference(args: {
  cliente: { id: string; email: string; nome: string };
  plano: { nome: string; valor: number };
  externalReference: string;
}): Promise<{ ok: boolean; initPoint: string | null; motivo?: string }> {
  const body = {
    items: [{
      title: `CJR Manutenção — ${args.plano.nome}`,
      quantity: 1,
      unit_price: Number(Number(args.plano.valor).toFixed(2)),
      currency_id: "BRL"
    }],
    payer: { email: args.cliente.email, name: args.cliente.nome },
    external_reference: args.externalReference,
    back_urls: {
      success: `${SITE}/manutencao/cliente/dashboard`,
      failure:  `${SITE}/manutencao/contratar?status=falha`,
      pending:  `${SITE}/manutencao/cliente/dashboard`
    },
    auto_return: "approved",
    statement_descriptor: "CJR MANUTENCAO"
  };
  const res = await fetch(`${MP_API}/checkout/preferences`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({} as any));
  console.log("[MP][preference] status:", res.status, "body:", JSON.stringify(data));
  if (!res.ok) {
    return { ok: false, motivo: (data as any).message || JSON.stringify(data), initPoint: null };
  }
  return { ok: true, initPoint: (data as any).init_point };
}

export async function buscarPreapproval(id: string): Promise<any | null> {
  const res = await fetch(`${MP_API}/preapproval/${id}`, {
    headers: { Authorization: `Bearer ${token()}` }
  });
  if (!res.ok) return null;
  return res.json();
}

export async function buscarPayment(id: string): Promise<any | null> {
  const res = await fetch(`${MP_API}/v1/payments/${id}`, {
    headers: { Authorization: `Bearer ${token()}` }
  });
  if (!res.ok) return null;
  return res.json();
}

// Preference para pagamento de material aprovado pelo lojista.
// Pix aparece em destaque no Checkout Pro. Cartão e boleto continuam disponíveis.
export async function criarPreferenceMaterial(args: {
  cliente: { id: string; email: string; nome: string };
  material: { id: string; descricao: string; valor: number };
}): Promise<{ ok: boolean; initPoint: string | null; preferenceId: string | null; motivo?: string }> {
  const body = {
    items: [{
      title: `Material — ${args.material.descricao}`.slice(0, 250),
      quantity: 1,
      unit_price: Number(Number(args.material.valor).toFixed(2)),
      currency_id: "BRL",
    }],
    payer: { email: args.cliente.email, name: args.cliente.nome },
    external_reference: `CJR-MAT-${args.material.id}`,
    back_urls: {
      success: `${SITE}/manutencao/cliente/materiais?status=pago&mat=${args.material.id}`,
      failure: `${SITE}/manutencao/cliente/materiais?status=falha&mat=${args.material.id}`,
      pending: `${SITE}/manutencao/cliente/materiais?status=pendente&mat=${args.material.id}`,
    },
    auto_return: "approved",
    statement_descriptor: "CJR MATERIAIS",
    // Pix recebe destaque visual no checkout; demais formas continuam habilitadas
    payment_methods: { installments: 1 },
  };
  const res = await fetch(`${MP_API}/checkout/preferences`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({} as any));
  console.log("[MP][material-preference] status:", res.status, "body:", JSON.stringify(data));
  if (!res.ok) {
    return { ok: false, motivo: (data as any).message || JSON.stringify(data), initPoint: null, preferenceId: null };
  }
  return { ok: true, initPoint: (data as any).init_point, preferenceId: (data as any).id };
}
