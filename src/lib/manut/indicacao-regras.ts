/**
 * Regras dinâmicas do programa Indique e Ganha (cupom tipo='representante').
 *
 * Um único código (ex: MZ2601) aplica regras DIFERENTES dependendo do plano
 * que o cliente escolhe na hora de contratar. Isso evita ter que criar 3 cupons
 * por representante e simplifica a divulgação ("use MZ2601 e ganhe desconto").
 *
 * Mapeamento (duração do plano em meses → regra):
 *   3 meses (trimestral) → 0% desconto cliente · 4% comissão representante
 *   6 meses (semestral) → 20% × 1 mês cliente · 7% comissão representante
 *  12 meses (anual)     → 20% × 2 meses cliente · 10% comissão representante
 *
 * Pra cupons normais (tipo='desconto' ou 'indicacao'), as regras armazenadas
 * em `manut_cupons.desconto_percentual / duracao_meses / cashback_pct` valem.
 * Esta tabela só é consultada quando tipo='representante'.
 */
export const REGRAS_INDICACAO_POR_DURACAO: Record<number, { desconto_pct: number; duracao_desconto_meses: number; comissao_pct: number; label: string }> = {
  3:  { desconto_pct: 0,  duracao_desconto_meses: 0, comissao_pct: 4,  label: "Trimestral" },
  6:  { desconto_pct: 20, duracao_desconto_meses: 1, comissao_pct: 7,  label: "Semestral" },
  12: { desconto_pct: 20, duracao_desconto_meses: 2, comissao_pct: 10, label: "Anual" },
};

/** Retorna a regra do programa indique e ganha para uma dada duração de plano (em meses). */
export function regraIndicacaoPorDuracao(meses: number) {
  return REGRAS_INDICACAO_POR_DURACAO[meses] || REGRAS_INDICACAO_POR_DURACAO[3];
}

/** Lista todas as regras (útil para exibir tabelas comparativas no admin e nos emails). */
export function listarRegrasIndicacao() {
  return Object.entries(REGRAS_INDICACAO_POR_DURACAO).map(([meses, r]) => ({
    meses: Number(meses),
    ...r,
  }));
}
