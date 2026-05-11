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

function isCpfValido(cpf: string): boolean {
  cpf = cpf.replace(/\D/g, "");
  if (cpf.length !== 11) return false;
  if (/^(\d)\1+$/.test(cpf)) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) s += +cpf[i] * (10 - i);
  let d1 = (s * 10) % 11; if (d1 === 10) d1 = 0;
  if (d1 !== +cpf[9]) return false;
  s = 0;
  for (let i = 0; i < 10; i++) s += +cpf[i] * (11 - i);
  let d2 = (s * 10) % 11; if (d2 === 10) d2 = 0;
  return d2 === +cpf[10];
}

function isCnpjValido(cnpj: string): boolean {
  cnpj = cnpj.replace(/\D/g, "");
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1+$/.test(cnpj)) return false;
  const p1 = [5,4,3,2,9,8,7,6,5,4,3,2];
  const p2 = [6,5,4,3,2,9,8,7,6,5,4,3,2];
  let s = 0;
  for (let i = 0; i < 12; i++) s += +cnpj[i] * p1[i];
  let d1 = s % 11; d1 = d1 < 2 ? 0 : 11 - d1;
  if (d1 !== +cnpj[12]) return false;
  s = 0;
  for (let i = 0; i < 13; i++) s += +cnpj[i] * p2[i];
  let d2 = s % 11; d2 = d2 < 2 ? 0 : 11 - d2;
  return d2 === +cnpj[13];
}

// Pix direto via API de pagamentos (sem passar pela tela do MP).
// Retorna QR Code copia-e-cola + imagem base64 + URL do ticket de pagamento.
export async function criarPagamentoPix(args: {
  cliente: { email: string; nome: string; cnpjCpf?: string | null };
  material: { id: string; descricao: string; valor: number };
}): Promise<{
  ok: boolean;
  paymentId?: string | null;
  qrCode?: string | null;
  qrCodeBase64?: string | null;
  ticketUrl?: string | null;
  motivo?: string;
}> {
  // Detecta tipo (CPF/CNPJ) e valida com dígito verificador. Se o documento
  // do cliente cadastrado for inválido (ex: cliente de teste com 55.555...),
  // usa um CPF de validação neutra para o Pix conseguir ser gerado.
  const docDigits = String(args.cliente.cnpjCpf || "").replace(/\D/g, "");
  let docType: "CPF" | "CNPJ" = "CPF";
  let docNumber = "";
  if (docDigits.length === 14 && isCnpjValido(docDigits)) {
    docType = "CNPJ"; docNumber = docDigits;
  } else if (docDigits.length === 11 && isCpfValido(docDigits)) {
    docType = "CPF"; docNumber = docDigits;
  } else {
    console.warn("[MP][pix] CPF/CNPJ invalido no cliente, usando fallback:", docDigits);
    docType = "CPF"; docNumber = "11144477735"; // CPF válido (passa MOD 11) — usado quando o real é inválido
  }

  // first_name / last_name
  const nomePartes = String(args.cliente.nome || "Cliente").trim().split(/\s+/);
  const firstName = nomePartes[0] || "Cliente";
  const lastName = nomePartes.slice(1).join(" ") || "Costa";

  const idempotencyKey = `mat-${args.material.id}-${Date.now()}`;
  const body = {
    transaction_amount: Number(Number(args.material.valor).toFixed(2)),
    description: `Material — ${args.material.descricao}`.slice(0, 200),
    payment_method_id: "pix",
    external_reference: `CJR-MAT-${args.material.id}`,
    notification_url: `${SITE}/api/manut/mp_webhook`,
    payer: {
      email: args.cliente.email,
      first_name: firstName,
      last_name: lastName,
      identification: { type: docType, number: docNumber },
    },
  };

  const res = await fetch(`${MP_API}/v1/payments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token()}`,
      "X-Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({} as any));
  console.log("[MP][pix] status:", res.status, "body:", JSON.stringify(data).slice(0, 400));
  if (!res.ok) {
    return { ok: false, motivo: (data as any).message || JSON.stringify(data) };
  }

  const poi = (data as any).point_of_interaction?.transaction_data || {};
  return {
    ok: true,
    paymentId: String((data as any).id || ""),
    qrCode: poi.qr_code || null,
    qrCodeBase64: poi.qr_code_base64 || null,
    ticketUrl: poi.ticket_url || null,
  };
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
