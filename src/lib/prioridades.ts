// Prioridades de caixa — pedido da Adriana em 17/09/2026:
//
//   "Tudo que for judicial, pessoas e FGTS são prioridades e devem ter saldos
//    para pagamento garantido."
//
// A razão é simples: atraso nessas três não se resolve pagando depois. Acordo
// judicial descumprido vira execução, verba de pessoal atrasada vira processo,
// e FGTS em atraso trava a certidão de regularidade (e com ela a licitação e o
// contrato com órgão público). As demais contas são negociáveis; estas não.
//
// Não existe categoria "Judicial" na Vobi, então o judicial é reconhecido pela
// categoria (Assessoria Jurídica, Bloqueios Bancários) OU pelo texto do
// lançamento — a empresa nomeia bem: "ACORDO JUDICIAL_NÃO PODE ATRASAR",
// "GUIA DE DEPÓSITO JUDICIAL", "CUSTAS INICIAIS", "ACORDO TRABALHISTA_...".

import type { ParcelaAberta } from "./vobiBaixa";

export type TipoPrioridade = "judicial" | "pessoas" | "fgts" | "fixas";

/** FGTS (filha de "Despesa de pessoal"). */
const CAT_FGTS = 21797536;

/** Categorias que por si só já caracterizam judicial. */
const CAT_JUDICIAL = new Set<number>([
  21797550, // Assessoria Jurídica
  22925365, // Bloqueios Bancários (penhora / bloqueio judicial)
]);

/** Filhas de "Despesa de pessoal" (21658017) — conferidas na Vobi em 17/09/2026. */
const CAT_PESSOAS = new Set<number>([
  21797725, // 13 salario
  21658007, // Adiantamento Salarial
  21797713, // Alimentação
  21797717, // Assist. Médica e Odontol.
  21658018, // Confraternizações
  21658020, // Cursos e Treinamentos
  21797553, // Darf 0561 IRRF
  21797530, // Ferias
  21797536, // FGTS
  21658022, // Gratificações
  21797555, // INSS
  21797528, // Mão-de-obra / Diarista
  21797561, // Medicina do trabalho
  21658021, // Medicina do Trabalho
  21797523, // Prestador de Serviço - PJ
  21797526, // Prolabore
  21797728, // Provisão de 13º, Férias e Rescisão
  21797537, // Rescisão
  21658046, // Retenção - GPS 2631 - INSS
  21797533, // Salario
  21797716, // Sindicato
  21797564, // Uniformes e EPI's
  21797710, // Vale Transporte
]);

/**
 * Texto que caracteriza judicial mesmo quando a categoria e outra — o caso
 * tipico e o acordo trabalhista, que fica na categoria "Rescisao".
 *
 * As alternativas sao ESTREITAS de proposito. Numa construtora, palavra solta
 * gera falso positivo caro: "alvara" e licenca de obra e dos bombeiros,
 * "vara" e barra de ferro (FERRO CA-50 10MM VARA 12M), "processo" e processo
 * de compra e processo seletivo, e "pericia" e vistoria de veiculo. Cada falso
 * positivo aqui infla o dinheiro que a Adriana precisa separar, entao essas
 * quatro exigem o contexto judicial junto.
 */
const RX_JUDICIAL =
  /JUDIC|JUR[IÍ]D|ADVOGAD|ADVOCACIA|RECLAMA[ÇC][AÃ]O TRABALH|ACORDO TRABALH|\bTRT\b|\bTJSP\b|PROCURADORIA|OFICIAIS DE JUSTI[CÇ]A|DEP[OÓ]SITO RECURSAL|EXECU[CÇ][AÃ]O FISCAL|CONDENA[ÇC]|PENHOR|BLOQUEIO JUDICIAL|\bCUSTAS?\b|\d+[ªA]\s*VARA|VARA D[OEA]\s+(TRABALHO|FAZENDA|C[IÍ]VEL)|ALVAR[AÁ]\s+(DE\s+LEVANTAMENTO|JUDICIAL)|PER[IÍ]CIA\s+(JUDICIAL|M[EÉ]DICA)|CONSULTA\s+PROCESSO|PROCESS[OP]\s*(N[º°]|JUDICIAL|TRABALHISTA|DE FUNCION[AÁ]RIO|\d{3,})/i;

/**
 * A LISTA DA ADRIANA (17/09/2026), dita com estas palavras: contas que nao
 * podem atrasar NUNCA, e que ela quer "sempre controlar com o dinheiro que
 * tenho em conta e entradas".
 *
 * Ela vem ANTES das regras por categoria, de proposito: se alguem trocar a
 * categoria do lancamento, estas continuam entrando. O aluguel do QG e o caso
 * que so existe por causa desta lista — a categoria dele e Aluguel, em
 * Despesas Administrativas, e nenhuma regra de judicial/pessoal/FGTS o pegaria.
 */
const NUNCA_ATRASA: Array<{ rx: RegExp; tipo: TipoPrioridade }> = [
  { rx: /\bFGTS\b/i, tipo: "fgts" },
  { rx: /ACORDO TRABALH[A-Z]*[_ ]*LYSNOR|LYSNOR/i, tipo: "judicial" },
  { rx: /ALUGUEL[_ ]*IM[OÓ]VEL[_ ]*NOVO[_ ]*DEPOSITO[_ ]*QG|ALUGUEL.*DEPOSITO[_ ]*QG/i, tipo: "fixas" },
  { rx: /NEGOCIA[ÇC][AÃ]O PARC RESCIS[AÃ]O/i, tipo: "pessoas" },
  { rx: /ACORDO DE PAGAMENTO DE RESCIS[AÃ]O/i, tipo: "pessoas" },
];

/** A conta esta na lista que a Adriana ditou? */
export function ehDaListaDaAdriana(p: ParcelaAberta): TipoPrioridade | null {
  const texto = `${p.descricao || ""} ${p.fornecedor || ""}`;
  for (const { rx, tipo } of NUNCA_ATRASA) if (rx.test(texto)) return tipo;
  return null;
}

/**
 * Classifica uma parcela em aberto. Devolve null quando não é prioridade.
 *
 * A ordem importa: judicial ganha de tudo (um acordo trabalhista está na
 * categoria Rescisão, mas o que manda é ser judicial), depois FGTS — que a
 * Adriana pediu separado justamente por causa da certidão — e por fim o resto
 * da folha.
 */
export function classificarPrioridade(p: ParcelaAberta): TipoPrioridade | null {
  // a lista ditada pela Adriana vem primeiro e ganha de qualquer categoria
  const daLista = ehDaListaDaAdriana(p);
  if (daLista) return daLista;
  const cat = p.idCategoria ?? 0;
  const texto = `${p.descricao || ""} ${p.fornecedor || ""}`;
  if (CAT_JUDICIAL.has(cat) || RX_JUDICIAL.test(texto)) return "judicial";
  if (cat === CAT_FGTS || /\bFGTS\b/i.test(texto)) return "fgts";
  if (CAT_PESSOAS.has(cat)) return "pessoas";
  return null;
}

export const ROTULO: Record<TipoPrioridade, string> = {
  judicial: "⚖️ JUDICIAL",
  pessoas: "👥 PESSOAS",
  fgts: "🏦 FGTS",
  fixas: "🔒 NÃO PODE ATRASAR",
};

/** Ícone curto para marcar a conta dentro de uma lista comum. */
export const ICONE: Record<TipoPrioridade, string> = {
  judicial: "⚖️",
  pessoas: "👥",
  fgts: "🏦",
  fixas: "🔒",
};

/** Ordem de exibição: o que dói mais primeiro. */
export const ORDEM: TipoPrioridade[] = ["judicial", "fgts", "pessoas", "fixas"];

/** Separa a lista em prioridades (por tipo) e o resto. */
export function separarPrioridades(lista: ParcelaAberta[]): {
  porTipo: Map<TipoPrioridade, ParcelaAberta[]>;
  prioritarias: ParcelaAberta[];
  demais: ParcelaAberta[];
} {
  const porTipo = new Map<TipoPrioridade, ParcelaAberta[]>();
  const prioritarias: ParcelaAberta[] = [];
  const demais: ParcelaAberta[] = [];
  for (const p of lista) {
    const t = classificarPrioridade(p);
    if (!t) {
      demais.push(p);
      continue;
    }
    if (!porTipo.has(t)) porTipo.set(t, []);
    porTipo.get(t)!.push(p);
    prioritarias.push(p);
  }
  return { porTipo, prioritarias, demais };
}

/**
 * Uma entrada em aberto conta como dinheiro NOVO no caixa da empresa?
 *
 * Não conta: transferência entre contas próprias e ajuste de caixa (o
 * dinheiro já era da empresa) e aluguel, que é receita pessoal e cai na
 * Caixa Pessoal — não serve para pagar obrigação da empresa. Sem esse
 * filtro a conta de 'dá ou não dá' fica otimista demais.
 */
const CAT_NAO_E_CAIXA_NOVO = new Set<number>([
  21796618, // Ajuste Caixa
  22896755, // Transferência entre Contas
  22957008, // Transferência entre Contas (receita)
  21796622, // Aluguel (receita pessoal)
]);

export function ehEntradaDeCaixa(p: ParcelaAberta): boolean {
  if (CAT_NAO_E_CAIXA_NOVO.has(p.idCategoria ?? 0)) return false;
  return !/TRANSFER[ÊE]NCIA ENTRE CONTAS|AJUSTE DE CAIXA/i.test(p.descricao || "");
}
