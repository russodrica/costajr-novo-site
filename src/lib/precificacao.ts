/**
 * Motor de precificação do módulo Vendas.
 *
 * Responde a pergunta que o "preço sugerido" da TrazPraCa NÃO responde:
 * depois das taxas do canal, quanto sobra de verdade?
 *
 * O preço sugerido da TrazPraCa é sempre custo × 1,95 (95% de markup bruto).
 * Depois das taxas do Mercado Livre / Shopee isso vira 15%–27% de margem real,
 * e em produto barato pode virar quase nada. Este módulo calcula o número real.
 *
 * Todas as taxas ficam em `vendas_config` (banco), não no código — marketplace
 * muda taxa com frequência e a Adriana precisa conseguir ajustar sem depender
 * de deploy.
 *
 * Fontes das taxas padrão (jul/2026): comissão ML 11–14% clássico / 16–19%
 * premium + custo fixo abaixo de R$79 + frete grátis obrigatório acima disso;
 * Shopee em faixas (20%+R$4 até 79,99; 14% + fixo por faixa acima).
 */

export type FaixaShopee = {
  /** teto da faixa; null = sem teto (última faixa) */
  ate: number | null;
  /** comissão percentual da faixa */
  pct: number;
  /** taxa fixa por item vendido, em reais */
  fixo: number;
};

/** Faixa de peso do frete do Mercado Livre. `ate_kg: null` = última faixa. */
export type FaixaFreteML = {
  ate_kg: number | null;
  /** quanto o VENDEDOR paga nessa faixa, em reais */
  custo: number;
};

export type TipoAnuncioML = "classico" | "premium";

export type ConfigPrecificacao = {
  /**
   * Comissão única — mantida por compatibilidade. Quando `ml_tipo_anuncio`
   * está definido, quem manda é a comissão do tipo escolhido.
   */
  ml_comissao_pct: number;
  /** taxa fixa por item cobrada pelo ML abaixo do limite de frete grátis */
  ml_custo_fixo: number;
  /** quanto o vendedor banca de frete acima do limite (estimativa) */
  ml_frete_estimado: number;
  /** a partir deste preço o frete grátis vira obrigatório no ML */
  ml_limite_frete_gratis: number;
  /**
   * Tipo de anúncio praticado. Clássico e Premium têm comissões bem
   * diferentes (o Premium paga o parcelamento sem juros do comprador) e a
   * diferença come margem: num produto de R$ 102 são 3 pontos percentuais,
   * que viram um quinto do lucro.
   */
  ml_tipo_anuncio: TipoAnuncioML;
  ml_comissao_classico_pct: number;
  ml_comissao_premium_pct: number;
  /**
   * Frete por faixa de peso. Usado quando o produto tem peso conhecido —
   * o que agora acontece, porque a planilha traz peso e dimensões.
   * Vazio = cai no `ml_frete_estimado` (o chute único de antes).
   *
   * ATENÇÃO: estes valores são ESTIMATIVA. O número real depende de peso,
   * dimensão, destino e reputação do vendedor, e só a API do Mercado Livre
   * sabe. O enriquecedor consulta a API por produto e grava o valor real;
   * quando ele existe, é ele que vale. Ver `resultadoML(..., freteReal)`.
   */
  ml_frete_faixas: FaixaFreteML[];
  shopee_faixas: FaixaShopee[];
  /** adicional de comissão da Shopee durante campanhas */
  shopee_campanha_pct: number;
  /** margem líquida que a Adriana quer atingir, em % */
  margem_alvo_pct: number;
  /**
   * Piso de margem quando o mercado não deixa chegar no alvo.
   *
   * Regra da Adriana (31/07/2026): "vamos manter 15% de margem para os
   * produtos que não estou competitiva, mas nunca zero". Ou seja, para
   * acompanhar concorrente o preço pode cair — até este piso e não abaixo
   * dele. Se nem no piso o produto fica competitivo, o portal NÃO persegue o
   * concorrente: mantém o preço do piso e sinaliza. Vender sem margem só
   * queima capital de giro e ainda gasta o limite da carteira da TrazPraCa.
   */
  margem_minima_pct: number;
};

export const CONFIG_PADRAO: ConfigPrecificacao = {
  ml_comissao_pct: 13,
  ml_custo_fixo: 6,
  ml_frete_estimado: 22,
  ml_limite_frete_gratis: 79,
  shopee_faixas: [
    { ate: 79.99, pct: 20, fixo: 4 },
    { ate: 99.99, pct: 14, fixo: 16 },
    { ate: 199.99, pct: 14, fixo: 20 },
    { ate: 499.99, pct: 14, fixo: 26 },
    { ate: null, pct: 14, fixo: 28 },
  ],
  shopee_campanha_pct: 0,
  margem_alvo_pct: 30,
  margem_minima_pct: 15,
  ml_tipo_anuncio: "classico",
  ml_comissao_classico_pct: 13,
  ml_comissao_premium_pct: 17,
  ml_frete_faixas: [],
};

export type ItemTaxa = { rotulo: string; valor: number };

export type Resultado = {
  canal: "ml" | "shopee";
  preco: number;
  custo: number;
  taxas: number;
  detalhe: ItemTaxa[];
  /** preço − custo − taxas */
  lucro: number;
  /** lucro ÷ preço, em % */
  margemPct: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Mescla config vinda do banco (campos podem faltar) com os padrões. */
export function normalizarConfig(bruto: Partial<ConfigPrecificacao> | null | undefined): ConfigPrecificacao {
  const c = { ...CONFIG_PADRAO, ...(bruto || {}) };
  const faixas = Array.isArray(c.shopee_faixas) && c.shopee_faixas.length
    ? [...c.shopee_faixas]
    : CONFIG_PADRAO.shopee_faixas;
  // ordena por teto; faixa sem teto (null) sempre por último
  faixas.sort((a, b) => (a.ate == null ? Infinity : a.ate) - (b.ate == null ? Infinity : b.ate));

  // Compatibilidade: até 01/08/2026 existia uma comissão única (`ml_comissao_pct`).
  // Se o banco traz esse valor e NÃO traz a comissão do clássico, o valor antigo
  // continua valendo — senão uma taxa que a Adriana ajustou à mão seria
  // silenciosamente trocada pelo padrão do código.
  const b = bruto || {};
  const classico = b.ml_comissao_classico_pct ?? b.ml_comissao_pct ?? CONFIG_PADRAO.ml_comissao_classico_pct;

  return {
    ...c,
    shopee_faixas: faixas,
    ml_comissao_classico_pct: classico,
    ml_frete_faixas: Array.isArray(c.ml_frete_faixas) ? c.ml_frete_faixas : [],
    ml_tipo_anuncio: c.ml_tipo_anuncio === "premium" ? "premium" : "classico",
  };
}


/**
 * Contexto do produto que muda a conta do Mercado Livre.
 *
 * Sem isso o motor usava um frete único de R$ 22 para tudo — o que trata uma
 * luminária de 1,6 kg igual a um quadro de 0,4 kg. Com peso, o frete sai da
 * faixa certa; com `freteReal` (consultado na API do ML pelo enriquecedor),
 * sai o número exato daquele anúncio.
 */
export type ContextoML = {
  pesoKg?: number | null;
  /** custo de frete devolvido pela API do Mercado Livre para ESTE produto */
  freteReal?: number | null;
  /** sobrepõe o tipo configurado, para comparar clássico x premium na tela */
  tipoAnuncio?: TipoAnuncioML;
};

/** Comissão vigente conforme o tipo de anúncio escolhido. */
export function comissaoMLPct(cfg: ConfigPrecificacao, tipo?: TipoAnuncioML): number {
  const escolhido = tipo || cfg.ml_tipo_anuncio || "classico";
  const pct = escolhido === "premium" ? cfg.ml_comissao_premium_pct : cfg.ml_comissao_classico_pct;
  return typeof pct === "number" ? pct : cfg.ml_comissao_pct;
}

export type FreteML = { valor: number; fonte: "api" | "faixa" | "estimativa" };

/**
 * Quanto o vendedor banca de frete acima do limite de frete grátis.
 *
 * Ordem de confiança: valor real da API do ML > faixa de peso configurada >
 * estimativa única. A `fonte` sobe junto para a tela poder dizer à Adriana se
 * aquele lucro está apoiado em número real ou em chute — a diferença entre os
 * dois já custou dinheiro antes.
 */
export function freteML(cfg: ConfigPrecificacao, ctx?: ContextoML): FreteML {
  const real = ctx?.freteReal;
  if (typeof real === "number" && real >= 0) return { valor: r2(real), fonte: "api" };

  const peso = ctx?.pesoKg;
  const faixas = Array.isArray(cfg.ml_frete_faixas) ? cfg.ml_frete_faixas : [];
  if (typeof peso === "number" && peso > 0 && faixas.length) {
    const ordenadas = [...faixas].sort(
      (a, b) => (a.ate_kg == null ? Infinity : a.ate_kg) - (b.ate_kg == null ? Infinity : b.ate_kg),
    );
    for (const f of ordenadas) {
      if (f.ate_kg == null || peso <= f.ate_kg) return { valor: r2(f.custo), fonte: "faixa" };
    }
    return { valor: r2(ordenadas[ordenadas.length - 1].custo), fonte: "faixa" };
  }

  return { valor: r2(cfg.ml_frete_estimado), fonte: "estimativa" };
}

const ROTULO_FONTE: Record<FreteML["fonte"], string> = {
  api: "Frete grátis (real, Mercado Livre)",
  faixa: "Frete grátis (faixa de peso)",
  estimativa: "Frete grátis (estimado — sem peso)",
};

export function taxasML(preco: number, cfg: ConfigPrecificacao, ctx?: ContextoML): ItemTaxa[] {
  const pct = comissaoMLPct(cfg, ctx?.tipoAnuncio);
  const tipo = (ctx?.tipoAnuncio || cfg.ml_tipo_anuncio) === "premium" ? "Premium" : "Clássico";
  const comissao = { rotulo: `Comissão ${tipo} ${pct}%`, valor: r2(preco * (pct / 100)) };

  if (preco < cfg.ml_limite_frete_gratis) {
    return [comissao, { rotulo: "Custo fixo (abaixo do limite)", valor: r2(cfg.ml_custo_fixo) }];
  }
  const frete = freteML(cfg, ctx);
  return [comissao, { rotulo: ROTULO_FONTE[frete.fonte], valor: frete.valor }];
}

export function faixaShopee(preco: number, cfg: ConfigPrecificacao): FaixaShopee {
  for (const f of cfg.shopee_faixas) {
    if (f.ate == null || preco <= f.ate) return f;
  }
  return cfg.shopee_faixas[cfg.shopee_faixas.length - 1];
}

export function taxasShopee(preco: number, cfg: ConfigPrecificacao): ItemTaxa[] {
  const f = faixaShopee(preco, cfg);
  const pctTotal = f.pct + (cfg.shopee_campanha_pct || 0);
  const itens: ItemTaxa[] = [
    { rotulo: `Comissão ${f.pct}%`, valor: r2(preco * (f.pct / 100)) },
    { rotulo: "Taxa fixa por item", valor: r2(f.fixo) },
  ];
  if (cfg.shopee_campanha_pct) {
    itens.push({ rotulo: `Campanha +${cfg.shopee_campanha_pct}%`, valor: r2(preco * (cfg.shopee_campanha_pct / 100)) });
  }
  void pctTotal;
  return itens;
}

function montar(canal: "ml" | "shopee", custo: number, preco: number, detalhe: ItemTaxa[]): Resultado {
  const taxas = detalhe.reduce((s, i) => s + i.valor, 0);
  const lucro = preco - custo - taxas;
  return {
    canal, preco: r2(preco), custo: r2(custo), taxas: r2(taxas), detalhe,
    lucro: r2(lucro),
    margemPct: preco > 0 ? r2((lucro / preco) * 100) : 0,
  };
}

export function resultadoML(
  custo: number, preco: number, cfg: ConfigPrecificacao, ctx?: ContextoML,
): Resultado {
  return montar("ml", custo, preco, taxasML(preco, cfg, ctx));
}

export function resultadoShopee(custo: number, preco: number, cfg: ConfigPrecificacao): Resultado {
  return montar("shopee", custo, preco, taxasShopee(preco, cfg));
}

/**
 * Menor preço no ML que atinge a margem alvo.
 * Considera que abaixo do limite paga taxa fixa e acima paga frete.
 */
export function precoParaMargemML(
  custo: number, margemAlvoPct: number, cfg: ConfigPrecificacao, ctx?: ContextoML,
): number | null {
  const c = comissaoMLPct(cfg, ctx?.tipoAnuncio) / 100;
  const m = margemAlvoPct / 100;
  const denom = 1 - c - m;
  if (denom <= 0) return null; // margem impossível: comissão + margem >= 100%

  const pBaixo = (custo + cfg.ml_custo_fixo) / denom;
  if (pBaixo < cfg.ml_limite_frete_gratis) return r2(pBaixo);

  const pAlto = (custo + freteML(cfg, ctx).valor) / denom;
  if (pAlto >= cfg.ml_limite_frete_gratis) return r2(pAlto);

  // vender exatamente no limite já supera a margem alvo
  return r2(cfg.ml_limite_frete_gratis);
}

/** Menor preço na Shopee que atinge a margem alvo (respeitando as faixas). */
export function precoParaMargemShopee(custo: number, margemAlvoPct: number, cfg: ConfigPrecificacao): number | null {
  const m = margemAlvoPct / 100;
  let piso = 0;
  for (const f of cfg.shopee_faixas) {
    const c = (f.pct + (cfg.shopee_campanha_pct || 0)) / 100;
    const denom = 1 - c - m;
    if (denom <= 0) { piso = f.ate ?? piso; continue; }
    const p = (custo + f.fixo) / denom;
    const teto = f.ate ?? Infinity;
    if (p <= teto) return r2(Math.max(p, piso));
    piso = teto;
  }
  return null;
}

/**
 * "Zona morta" do Mercado Livre: faixa de preço onde vender MAIS caro rende
 * MENOS, porque ao cruzar o limite o frete grátis passa a ser obrigatório.
 * Nunca precificar dentro dela. Independe do custo.
 */
export function zonaMortaML(cfg: ConfigPrecificacao, ctx?: ContextoML): { de: number; ate: number } | null {
  const c = comissaoMLPct(cfg, ctx?.tipoAnuncio) / 100;
  const limite = cfg.ml_limite_frete_gratis;
  const abaixo = limite - 0.01;
  const salto = freteML(cfg, ctx).valor - cfg.ml_custo_fixo;
  if (salto <= 0) return null; // frete não é mais caro que a taxa fixa: sem zona morta
  const saida = abaixo + salto / (1 - c);
  return { de: r2(limite), ate: r2(saida) };
}

/**
 * Empurra um preço para fora da zona morta do ML.
 *
 * Dentro da zona, qualquer preço rende MENOS do que um centavo abaixo dela —
 * então a saída é sempre para baixo, nunca para cima. Não é escolha de
 * estratégia, é aritmética: a R$ 78,99 sobra mais do que a R$ 90,00.
 */
export function fugirDaZonaMortaML(preco: number, cfg: ConfigPrecificacao, ctx?: ContextoML): number {
  const zm = zonaMortaML(cfg, ctx);
  if (!zm || preco < zm.de || preco > zm.ate) return r2(preco);
  return r2(zm.de - 0.01);
}

export type MotivoPreco = "alvo" | "mercado" | "piso";

export type PrecoRecomendado = {
  preco: number;
  motivo: MotivoPreco;
  margemPct: number;
  /** preço que atingiria a margem alvo */
  precoAlvo: number | null;
  /** preço que atinge a margem mínima — o portal nunca desce disso */
  precoPiso: number | null;
  /** true quando o mercado está abaixo do piso: aqui não dá para competir */
  foraDeCompeticao: boolean;
};

/**
 * Decide o preço de venda de um produto num canal.
 *
 * A regra, na ordem:
 *   1. mira a margem alvo (30%);
 *   2. se o concorrente está mais barato que isso, ACOMPANHA o concorrente —
 *      mas só até a margem mínima (15%);
 *   3. se nem a margem mínima cabe no preço do concorrente, PARA no piso e
 *      marca `foraDeCompeticao`. Não persegue o concorrente até o prejuízo.
 *
 * `referenciaMercado` é o preço praticado por anúncio semelhante (vem da
 * planilha). Sem referência, o preço é sempre o alvo.
 */
export function precoRecomendado(
  canal: "ml" | "shopee",
  custo: number,
  cfg: ConfigPrecificacao,
  referenciaMercado?: number | null,
  ctx?: ContextoML,
): PrecoRecomendado {
  const paraMargem = (m: number) =>
    canal === "ml" ? precoParaMargemML(custo, m, cfg, ctx) : precoParaMargemShopee(custo, m, cfg);
  const avaliarPreco = (p: number) =>
    canal === "ml" ? resultadoML(custo, p, cfg, ctx) : resultadoShopee(custo, p, cfg);
  const ajustar = (p: number) => (canal === "ml" ? fugirDaZonaMortaML(p, cfg, ctx) : r2(p));

  const precoAlvo = paraMargem(cfg.margem_alvo_pct);
  const precoPiso = paraMargem(cfg.margem_minima_pct);

  const decidir = (preco: number, motivo: MotivoPreco, foraDeCompeticao = false): PrecoRecomendado => {
    const ajustado = ajustar(preco);
    return {
      preco: ajustado,
      motivo,
      margemPct: avaliarPreco(ajustado).margemPct,
      precoAlvo,
      precoPiso,
      foraDeCompeticao,
    };
  };

  // Sem alvo calculável (comissão + margem >= 100%) não há o que recomendar.
  if (precoAlvo == null) {
    return { preco: 0, motivo: "alvo", margemPct: 0, precoAlvo: null, precoPiso, foraDeCompeticao: true };
  }

  const ref = typeof referenciaMercado === "number" && referenciaMercado > 0 ? referenciaMercado : null;
  if (ref == null || ref >= precoAlvo) return decidir(precoAlvo, "alvo");
  if (precoPiso != null && ref >= precoPiso) return decidir(ref, "mercado");
  return decidir(precoPiso ?? precoAlvo, "piso", true);
}

export type Avaliacao = {
  ml: Resultado;
  shopee: Resultado;
  melhorCanal: "ml" | "shopee";
  /** true se o preço sugerido dá prejuízo em algum canal */
  temPrejuizo: boolean;
  /** true se a margem ficou abaixo do alvo em ambos os canais */
  abaixoDoAlvo: boolean;
  /** true se o preço cai na zona morta do ML */
  naZonaMortaML: boolean;
  precoMinimoML: number | null;
  precoMinimoShopee: number | null;
  /** preço que ainda entrega a margem mínima — o chão da negociação */
  precoPisoML: number | null;
  precoPisoShopee: number | null;
  /** de onde veio o frete usado na conta do ML: api, faixa de peso ou chute */
  freteML: FreteML;
  /** comissão aplicada e o tipo de anúncio que a gerou */
  comissaoMLPct: number;
  tipoAnuncioML: TipoAnuncioML;
  /** o mesmo produto na outra modalidade, para comparar lado a lado */
  mlOutroTipo: Resultado;
  /** true se o preço praticado já está abaixo do piso de margem mínima */
  abaixoDoPiso: boolean;
};

/** Avaliação completa de um produto a um dado preço de venda. */
export function avaliar(
  custo: number, preco: number, cfg: ConfigPrecificacao, ctx?: ContextoML,
): Avaliacao {
  const ml = resultadoML(custo, preco, cfg, ctx);
  const shopee = resultadoShopee(custo, preco, cfg);
  const zm = zonaMortaML(cfg, ctx);
  const tipo: TipoAnuncioML = ctx?.tipoAnuncio || cfg.ml_tipo_anuncio || "classico";
  const outro: TipoAnuncioML = tipo === "premium" ? "classico" : "premium";
  return {
    ml, shopee,
    freteML: freteML(cfg, ctx),
    comissaoMLPct: comissaoMLPct(cfg, tipo),
    tipoAnuncioML: tipo,
    mlOutroTipo: resultadoML(custo, preco, cfg, { ...(ctx || {}), tipoAnuncio: outro }),
    melhorCanal: ml.lucro >= shopee.lucro ? "ml" : "shopee",
    temPrejuizo: ml.lucro < 0 || shopee.lucro < 0,
    abaixoDoAlvo: ml.margemPct < cfg.margem_alvo_pct && shopee.margemPct < cfg.margem_alvo_pct,
    abaixoDoPiso: ml.margemPct < cfg.margem_minima_pct && shopee.margemPct < cfg.margem_minima_pct,
    naZonaMortaML: !!zm && preco >= zm.de && preco <= zm.ate,
    precoMinimoML: precoParaMargemML(custo, cfg.margem_alvo_pct, cfg, ctx),
    precoMinimoShopee: precoParaMargemShopee(custo, cfg.margem_alvo_pct, cfg),
    precoPisoML: precoParaMargemML(custo, cfg.margem_minima_pct, cfg, ctx),
    precoPisoShopee: precoParaMargemShopee(custo, cfg.margem_minima_pct, cfg),
  };
}
