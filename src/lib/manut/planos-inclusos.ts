// Regras de inclusão de visitas extras e chamados emergenciais por duração do plano.
// Fonte única de verdade — consumida pelo wizard de contratação, pelo backend de
// chamados (decremento de saldo) e pelo painel do cliente (exibição).

export type DuracaoMeses = 1 | 3 | 6 | 12;

export interface InclusoesPlano {
  extras: number;
  emergenciais: number;
}

export const INCLUSOES_POR_DURACAO: Record<DuracaoMeses, InclusoesPlano> = {
  1: { extras: 0, emergenciais: 0 },
  3: { extras: 1, emergenciais: 1 },
  6: { extras: 6, emergenciais: 2 },
  12: { extras: 12, emergenciais: 4 },
};

export function inclusoesParaDuracao(meses: number): InclusoesPlano {
  return INCLUSOES_POR_DURACAO[(meses as DuracaoMeses)] ?? { extras: 0, emergenciais: 0 };
}
