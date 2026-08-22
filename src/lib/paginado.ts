// ---------------------------------------------------------------------------
// Ler tabela grande do Supabase sem cair no teto silencioso de 1.000 linhas.
//
// Por que existe (21/08/2026): o PostgREST corta TODA resposta em 1.000 linhas
// e não avisa — nem erro, nem flag. Pedir `.limit(2000)` não adianta: o corte é
// do servidor. O resultado é uma tela que parece certa e mente: o catálogo
// mostrava "1000 no catálogo" e "447 + 553" (1.000 redondo) enquanto a
// TrazPraCa tem milhares de produtos. Pior, a busca do custo das vendas
// enxergava só um pedaço arbitrário do catálogo e apagou o custo de 7 vendas.
//
// A única saída é paginar de verdade, com `.range()`, até vir uma página menor
// que o passo — aí acabou.
// ---------------------------------------------------------------------------

/**
 * @param montarQuery recebe o intervalo e devolve a query JÁ com `.range(de, ate)`.
 *                    Precisa ser uma função porque o builder do Supabase não pode
 *                    ser reaproveitado depois de executado.
 * @param passo       linhas por página (1.000 = o teto do servidor).
 * @param teto        trava de segurança contra laço infinito.
 */
export async function lerTudo<T = any>(
  montarQuery: (de: number, ate: number) => any,
  passo = 1000,
  teto = 100000,
): Promise<T[]> {
  const tudo: T[] = [];
  for (let de = 0; de < teto; de += passo) {
    const { data, error } = await montarQuery(de, de + passo - 1);
    if (error) throw new Error(error.message);
    const pagina: T[] = data || [];
    tudo.push(...pagina);
    // Página menor que o passo = última página. Igual ao passo = pode ter mais.
    if (pagina.length < passo) break;
  }
  return tudo;
}

/** Igual ao lerTudo, mas devolve [] em vez de estourar — para tela que não pode quebrar. */
export async function lerTudoSeguro<T = any>(
  montarQuery: (de: number, ate: number) => any,
  passo = 1000,
  teto = 100000,
): Promise<{ linhas: T[]; erro: string | null }> {
  try {
    return { linhas: await lerTudo<T>(montarQuery, passo, teto), erro: null };
  } catch (e: any) {
    return { linhas: [], erro: e?.message || "falha ao ler" };
  }
}
