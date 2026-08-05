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

/** Lê a lista de bancos/cartões que NÃO podem ser enviados. Nunca lança: em erro, devolve vazio. */
export async function bancosSigilosos(db: any): Promise<string[]> {
  try {
    const { data } = await db.from("doc_bancos_sigilosos").select("*");
    // `bloqueia_envio` só existe a partir da migration 081; antes disso, a simples
    // presença na tabela já significava "não enviar" — daí o `!== false`.
    return ((data || []) as any[]).filter((r) => r.bloqueia_envio !== false).map((r) => String(r.banco || "")).filter(Boolean);
  } catch {
    return [];
  }
}

/** Bancos/cartões cujos documentos ficam ESCONDIDOS dos usuários externos (contador). */
export async function bancosRestritosExterno(db: any): Promise<string[]> {
  try {
    const { data } = await db.from("doc_bancos_sigilosos").select("*");
    return ((data || []) as any[]).filter((r) => r.restrito_externo === true).map((r) => String(r.banco || "")).filter(Boolean);
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

// ── RESTRIÇÃO A USUÁRIOS EXTERNOS (perfil "fornecedor" — o contador) ──────────
// Diferente do sigilo acima (que é sobre ENVIAR), aqui o documento não existe
// para o externo: não aparece na tela dele e o link direto é recusado.
// A equipe interna (admin, financeiro, jurídico) continua vendo tudo.

/** Exceções: quem de fora pode ver cada documento restrito. Chave = `${tabela}:${registro_id}`. */
export async function externosPermitidos(db: any, tabela: string, ids: string[]): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  if (!ids.length) return out;
  try {
    const { data } = await db.from("doc_externo_permitido").select("registro_id, profile_id").eq("tabela", tabela).in("registro_id", ids);
    for (const r of (data || []) as any[]) {
      const k = String(r.registro_id);
      (out[k] ||= []).push(String(r.profile_id));
    }
  } catch { /* tabela ainda não existe (antes da migration 081) → sem exceções */ }
  return out;
}

/**
 * Este documento está restrito a externos? (pelo próprio item OU pelo banco/cartão)
 * `restritos` vem de bancosRestritosExterno().
 */
export function linhaRestritaExterno(row: any, restritos: string[]): boolean {
  if (!row) return false;
  if (row.restrito_externo) return true;
  return bancoEhSigiloso(row.banco ?? row.cartao, restritos);
}

/**
 * REGRA FINAL de quem enxerga o quê. Use nas telas e nas rotas de download.
 *  - usuário interno  → vê sempre (a restrição é só para externos);
 *  - externo + documento não restrito → vê;
 *  - externo + documento restrito → só vê se estiver liberado nome a nome.
 */
export function podeVerComoExterno(
  row: any,
  opts: { ehExterno: boolean; profileId?: string | null; restritos: string[]; permitidos?: string[] },
): boolean {
  if (!opts.ehExterno) return true;
  if (!linhaRestritaExterno(row, opts.restritos)) return true;
  const id = String(opts.profileId || "");
  return !!id && (opts.permitidos || []).includes(id);
}
