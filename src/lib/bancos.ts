// Catálogo de bancos/cartões — fonte ÚNICA.
//
// Ficava só dentro de doc-bancarios.astro. Virou lib porque a tela de
// Fornecedores precisa da mesma lista para montar as caixinhas de "quais bancos
// esta pessoa de fora pode ver" — e duas listas separadas viravam, cedo ou
// tarde, um banco liberado sem querer.

export const BANCOS = [
  "Banco do Brasil",
  "Caixa Econômica Federal",
  "Santander",
  "Sicoob",
  "Bradesco",
  "Itaú",
  "Nubank",
  "VillelaPay",
  "Banco Inter",
];

/** Contas criadas depois: só entram nos extratos A PARTIR do mês informado. */
export const BANCO_DESDE: Record<string, string> = { "VillelaPay": "2026-06", "Banco Inter": "2024-01" };

/** Cartões de crédito com fatura mensal (não fazem parte do escopo do fornecedor). */
export const CARTOES = ["Nubank", "Itaú"];

export const ymOf = (a: number, m: number) => `${a}-${String(m).padStart(2, "0")}`;
export const bancosDoMes = (a: number, m: number) =>
  BANCOS.filter((b) => !BANCO_DESDE[b] || ymOf(a, m) >= BANCO_DESDE[b]);
