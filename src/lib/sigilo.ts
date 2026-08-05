// Sigilo de compartilhamento — regra ÚNICA usada pelo painel e pelas APIs de envio.
//
// Um documento é "sigiloso" (não pode ser enviado por e-mail/WhatsApp) quando:
//   a) o próprio item está marcado (coluna nao_compartilhar), OU
//   b) o banco/cartão dele está na lista doc_bancos_sigilosos (ex.: VillelaPay).
//
// Isso NÃO esconde o documento de quem tem acesso à tela — só impede que ele saia
// da empresa pelos botões de compartilhar. O bloqueio é aplicado no SERVIDOR: as
// rotas de e-mail/WhatsApp descartam esses itens mesmo que venham no pedido.

export const normBanco = (s: string) =>
  String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

/** Lê a lista de bancos/cartões marcados como sigilosos. Nunca lança: em erro, devolve vazio. */
export async function bancosSigilosos(db: any): Promise<string[]> {
  try {
    const { data } = await db.from("doc_bancos_sigilosos").select("banco");
    return ((data || []) as any[]).map((r) => String(r.banco || "")).filter(Boolean);
  } catch {
    return [];
  }
}

/** O banco/cartão do documento está na lista de sigilosos? (comparação sem acento/caixa) */
export function bancoEhSigiloso(banco: string | null | undefined, sigilosos: string[]): boolean {
  if (!banco) return false;
  const n = normBanco(banco);
  if (!n) return false;
  return sigilosos.some((b) => normBanco(b) === n);
}

/**
 * Regra final para UMA linha de documento bancário (extrato / fatura / empréstimo).
 * `row.nao_compartilhar` + o banco (campo `banco` nos extratos/empréstimos, `cartao` nas faturas).
 */
export function linhaEhSigilosa(row: any, sigilosos: string[]): boolean {
  if (!row) return false;
  if (row.nao_compartilhar) return true;
  return bancoEhSigiloso(row.banco ?? row.cartao, sigilosos);
}
