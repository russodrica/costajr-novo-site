// Situação Financeira (aba da Diretoria, só admin).
// - Tabelas fin_sf_* (migration 118): dívidas por grupo, protestos, plano de ação e blocos do painel.
// - v2 (migration 119, 14/10/2026): proposta de quitação e "quitada" por dívida, protesto cancelado,
//   lista do que há A REAVER (fin_sf_reaver) e plano de ação novo (fin_sf_acoes.plano = 'v2').
// - Leitura AO VIVO da Vobi, com cache de 1 h em vobi_cache (a cota é 1000 consultas/h para a integração inteira):
//   (1) fluxo mensal realizado pelo relatório da tela (/financial/cashFlow?source=report), classificado por categoria;
//   (2) contas a pagar em aberto agrupadas em imposto / banco / fornecedor / estrutura fixa / trabalhista...
// A classificação das categorias veio do levantamento de 13/10/2026 (D:/temp/situacao_fin/calc.mjs).
import { supabaseAdmin } from "./supabase";
import { vobiConfigurado, vobiGetJson } from "./vobi";
import { vencimentosNoPeriodo, VobiCotaError, type ParcelaAberta } from "./vobiBaixa";

// ───────────────────────── enums (validados na API) ─────────────────────────
export const GRUPOS_DIVIDA = ["imposto", "banco", "fornecedor", "outro"] as const;
export type GrupoDivida = (typeof GRUPOS_DIVIDA)[number];
export const STATUS_ACAO = ["ideia", "testando", "em_andamento", "feito", "descartado"] as const;
export type StatusAcao = (typeof STATUS_ACAO)[number];
export const ROTULO_STATUS: Record<StatusAcao, string> = {
  ideia: "Ideia", testando: "Testando", em_andamento: "Em andamento", feito: "Feito", descartado: "Descartado",
};
/** Tipos do que a empresa tem A REAVER (fin_sf_reaver.tipo), na ordem em que aparecem na tela. */
export const TIPOS_REAVER = ["processo", "credito_tributario", "consorcio", "outro"] as const;
export type TipoReaver = (typeof TIPOS_REAVER)[number];
export const ROTULO_TIPO_REAVER: Record<TipoReaver, string> = {
  processo: "Processos", credito_tributario: "Créditos tributários", consorcio: "Consórcios", outro: "Outros",
};
/** Chance de o valor voltar (fin_sf_reaver.chance). */
export const CHANCES = ["alta", "media", "baixa", "nao_sei"] as const;
export type Chance = (typeof CHANCES)[number];
export const ROTULO_CHANCE: Record<Chance, string> = { alta: "Alta", media: "Média", baixa: "Baixa", nao_sei: "Não sei" };
/** Se o credor está cobrando ativamente uma dívida VENCIDA (fin_sf_dividas.cobranca, migration 120). */
export const COBRANCAS = ["com_cobranca", "sem_cobranca"] as const;
export type Cobranca = (typeof COBRANCAS)[number];
export const ROTULO_COBRANCA: Record<Cobranca, string> = { com_cobranca: "Com cobrança", sem_cobranca: "Sem cobrança" };
/** Situações que, por si, são cobrança ativa (usadas quando fin_sf_dividas.cobranca é null): protesto, intimação
 *  de protesto, execução/ação judicial, citação e inscrição em dívida ativa. Banco em execução = saldo inteiro vencido. */
export const SITUACOES_COM_COBRANCA = ["protestada", "intimada", "execucao", "ajuizada", "citada", "inscrita"] as const;

// ───────────────────────── tipos das tabelas ─────────────────────────
export type SfDivida = {
  id: string; grupo: GrupoDivida; subgrupo: string | null; credor: string; identificacao: string | null;
  natureza: string | null; retido: boolean;
  /** Desde a migration 120: SÓ O VENCIDO (o que conta como dívida). O que vence depois fica em valor_a_vencer. */
  valor: number | null; valor_teto: number | null; parcela_mensal: number | null;
  situacao: string | null; risco: string | null; data_ref: string | null; fonte: string | null; observacao: string | null;
  ordem: number | null; ativo: boolean;
  /** v2 (migration 119): valor de quitação proposto/negociado, observação da proposta e quitação */
  valor_proposta: number | null; proposta_obs: string | null;
  quitada: boolean; quitada_em: string | null; valor_pago: number | null;
  /** migration 120: parcelas futuras (despesa comprometida, fora da dívida) e a próxima a vencer */
  valor_a_vencer: number | null; proximo_vencimento: string | null;
  /** migration 120: null = deriva da situação (SITUACOES_COM_COBRANCA) */
  cobranca: Cobranca | null;
  /** migration 120: fornecedor na Vobi — "Atualizar da Vobi" grava vencido/a vencer/próximo vencimento */
  vobi_fornecedor_id: number | null;
  /** migration 120: a Adriana marcou que a despesa comprometida NÃO vai acontecer */
  comprometida_cortada: boolean; cortada_em: string | null;
  atualizado_por?: string | null;
  updated_at?: string | null;
};
export type SfProtesto = {
  id: string; secao: string; grupo: string | null; tabeliao: string; credor: string; credor_cnpj: string | null;
  documento: string | null; valor_principal: number | null; valor_protestado: number | null; custas: number | null;
  vencimento: string | null; data_protocolo: string | null; prazo_limite: string | null; data_protesto: string | null;
  protocolo: string | null; situacao_vobi: string | null; confianca: string | null; observacao: string | null;
  fontes: string | null; resposta_cartorio: string | null; ordem: number | null; ativo: boolean;
  /** v2 (migration 119) */
  cancelado: boolean; cancelado_em: string | null;
};
export type SfAcao = {
  id: string; codigo: number | null; onda: number | null; titulo: string; grupo: string | null; descricao: string | null;
  como_o_mercado_fatura: string | null; investimento: string | null; dificuldade: string | null;
  prazo_primeiro_faturamento: string | null; potencial_mensal: string | null; margem_tipica: string | null;
  precisa_de: string | null; impeditivos: string | null; primeiros_passos: string[] | null; roteiro_venda: string | null;
  fontes: string[] | null; ajuste_revisor: string | null; descartada: boolean; motivo_descarte: string | null;
  top10_ordem: number | null; top10_porque: string | null; status: StatusAcao; responsavel: string | null;
  prazo: string | null; notas: string | null; ordem: number | null;
  /** v2 (migration 119): 'v1' = 44 ideias de 13/10 (histórico); 'v2' = plano novo de 14/10 */
  plano: string; valor_vendido: number | null;
  updated_at?: string | null;
};
export type SfReaver = {
  id: string; tipo: TipoReaver; titulo: string; contraparte: string | null; valor_estimado: number | null;
  chance: Chance | null; situacao: string | null; previsao: string | null; fonte: string | null; observacao: string | null;
  recebido: boolean; recebido_em: string | null; valor_recebido: number | null; ordem: number | null; ativo: boolean;
  atualizado_por?: string | null; created_at?: string; updated_at?: string | null;
};
export type SfPainel = { chave: string; dados: any; atualizado_em: string };

/** Lê as tabelas. Se a migration 118 ainda não rodou, devolve `faltaMigration: true` em vez de quebrar a página.
 *  A lista A REAVER (migration 119) é opcional: se a tabela não existir, volta `reaver: []` sem erro. */
export async function carregarSituacao(): Promise<{
  faltaMigration: boolean; erro?: string;
  dividas: SfDivida[]; protestos: SfProtesto[]; acoes: SfAcao[]; reaver: SfReaver[]; painel: Record<string, any>;
}> {
  const db = supabaseAdmin();
  const [d, p, a, k, r] = await Promise.all([
    db.from("fin_sf_dividas").select("*").eq("ativo", true).order("grupo").order("ordem", { nullsFirst: false }).limit(2000),
    db.from("fin_sf_protestos").select("*").eq("ativo", true).order("ordem", { nullsFirst: false }).limit(2000),
    db.from("fin_sf_acoes").select("*").order("onda").order("ordem", { nullsFirst: false }).limit(500),
    db.from("fin_sf_painel").select("*").limit(100),
    db.from("fin_sf_reaver").select("*").eq("ativo", true).order("ordem", { nullsFirst: false }).limit(500),
  ]);
  const erro = d.error || p.error || a.error || k.error;
  if (erro) {
    const falta = /does not exist|schema cache|relation|Could not find the table/i.test(erro.message || "");
    return { faltaMigration: falta, erro: erro.message, dividas: [], protestos: [], acoes: [], reaver: [], painel: {} };
  }
  if (r.error) console.warn("[situacao-financeira] fin_sf_reaver indisponível:", r.error.message);
  const painel: Record<string, any> = {};
  for (const row of (k.data || []) as SfPainel[]) painel[row.chave] = row.dados;
  // linhas de antes das migrations 119/120 podem vir sem os campos novos (select * traz só o que existe): completa com o padrão
  const dividas = ((d.data || []) as SfDivida[]).map((x) => ({
    ...x, valor_proposta: x.valor_proposta ?? null, proposta_obs: x.proposta_obs ?? null,
    quitada: x.quitada === true, quitada_em: x.quitada_em ?? null, valor_pago: x.valor_pago ?? null,
    valor_a_vencer: x.valor_a_vencer ?? null, proximo_vencimento: x.proximo_vencimento ?? null,
    cobranca: (COBRANCAS as readonly string[]).includes(String(x.cobranca)) ? x.cobranca : null,
    vobi_fornecedor_id: x.vobi_fornecedor_id ?? null,
    comprometida_cortada: x.comprometida_cortada === true, cortada_em: x.cortada_em ?? null,
  }));
  const protestos = ((p.data || []) as SfProtesto[]).map((x) => ({ ...x, cancelado: x.cancelado === true, cancelado_em: x.cancelado_em ?? null }));
  const acoes = ((a.data || []) as SfAcao[]).map((x) => ({ ...x, plano: x.plano || "v1", valor_vendido: x.valor_vendido ?? null }));
  return {
    faltaMigration: false,
    dividas, protestos, acoes,
    reaver: r.error ? [] : ((r.data || []) as SfReaver[]),
    painel,
  };
}

// ───────────────────────── classificação das categorias da Vobi ─────────────────────────
export type Classe =
  | "RECEITA_OPERACIONAL" | "NAO_OPERACIONAL" | "FIXA" | "VARIAVEL_OBRA" | "TRIBUTO_VENDA"
  | "DIVIDA" | "REPASSE_PF" | "NAO_RECORRENTE" | "NEUTRA";

const CLASSE_LISTA: Array<[Classe, number[]]> = [
  ["RECEITA_OPERACIONAL", [21657977, 21657978]],
  ["NAO_OPERACIONAL", [21796619, 21796616, 21657981, 22881525, 22446884, 21796621]],
  ["REPASSE_PF", [21796622, 21797549]],
  ["NEUTRA", [22957008, 21796618, 22896755, 21797730, 21797379, 21891180]],
  ["FIXA", [
    21797533, 21797530, 21797536, 21797713, 21658007, 21797526, 21797523, 21797561, 21658021, 21797717, 21797716,
    21797710, 21797555, 21797725, 21797553, 23000270, 21797564, 21658018, 21658020, 21797543, 21797525, 21797550, 21797377,
    21797560, 21797538, 21797569, 21797539, 21797547, 21797532, 21658057, 21658058, 21658062, 22039501, 21797714,
    21658033, 21658048, 23118518, 21658035, 21658053, 21658052, 21797548, 21797540, 21658086,
  ]],
  ["VARIAVEL_OBRA", [21797528, 21797558, 21797527, 21797521, 21797559, 21797520, 21797724, 21797544, 21658001, 21658003, 21797376]],
  ["TRIBUTO_VENDA", [21797554, 21797562, 21797546, 21797534, 21797545]],
  ["DIVIDA", [21797537, 22881524, 21797568, 22925365, 21797531, 21797541, 21658110, 22223057, 21797718]],
  ["NAO_RECORRENTE", [21797732, 21797551, 21797552, 21797711]],
];
export const CLASSE_CATEGORIA: Record<number, Classe> = Object.fromEntries(
  CLASSE_LISTA.flatMap(([c, ids]) => ids.map((id) => [id, c])),
) as Record<number, Classe>;

/** Categorias "mistas": a mesma categoria tem conta fixa e conta de dívida; separa pela linha. */
export function classeDaParcela(idCategoria: number | null, fornecedor: string | null, descricao: string | null): Classe | "SEM_CLASSE" {
  const n = String(descricao || "").toUpperCase();
  const f = String(fornecedor || "").toUpperCase();
  switch (idCategoria) {
    case 21797550: return /ARPINI|F\.?\s?JOGO|JUSBRASIL|^ONR/.test(`${f} ${n}`) && !/DILIGENC|NOTA DE DEBITO/.test(n) ? "FIXA" : "DIVIDA";
    case 21797377: return /CONSISTE/.test(f) || /ACORDO|NEGOCIA/.test(n) ? "DIVIDA" : "FIXA";
    case 21797560: return /NEGOCIA/.test(n) ? "DIVIDA" : "FIXA";
    case 21797536: return /RESCIS/.test(n) ? "DIVIDA" : "FIXA";
    case 21797523: return /QZ MANUT/.test(f) ? "VARIAVEL_OBRA" : "FIXA";
  }
  return (idCategoria && CLASSE_CATEGORIA[idCategoria]) || "SEM_CLASSE";
}

export const GRUPOS_ABERTO = [
  "imposto_parcelado", "imposto_corrente", "banco", "socios", "trabalhista", "acordo_juridico",
  "fornecedor_obra", "fornecedor_estrutura", "fornecedor_contingente", "estrutura_fixa", "pessoa_fisica", "outros",
] as const;
export type GrupoAberto = (typeof GRUPOS_ABERTO)[number];
export const ROTULO_GRUPO_ABERTO: Record<GrupoAberto, string> = {
  imposto_parcelado: "Impostos parcelados (Prefeitura)",
  imposto_corrente: "Impostos lançados na Vobi (inclui parcelamentos federais rompidos)",
  banco: "Bancos e cartões",
  socios: "Sócios (pró-labore e empréstimos)",
  trabalhista: "Acordos trabalhistas e rescisões",
  acordo_juridico: "Acordos com fornecedores e advogados",
  fornecedor_obra: "Fornecedores de obra",
  fornecedor_estrutura: "Fornecedores da estrutura (PJ, advogado, contador, aluguel, sistemas)",
  fornecedor_contingente: "Honorário da Tax All (só é devido se o crédito for compensado)",
  estrutura_fixa: "Pessoal e outras contas fixas (FGTS, plano de saúde, sindicato)",
  pessoa_fisica: "Pessoa física (fora da empresa)",
  outros: "Outros",
};

/**
 * Categorias que o levantamento de 13/10/2026 conta como FORNECEDOR (material de obra, prestadores e mão de obra,
 * assessorias jurídica/contábil/consultoria, estrutura: aluguel, telefonia, licenças, sistemas, veículos, brindes,
 * manutenção, energia, Correios). Com elas, a soma ao vivo bate com o total do levantamento (R$ 547.017,67 em 13/10).
 */
export const CAT_FORNECEDOR = new Set<number>([
  21797527, 21797523, 21797528, 21658001, 21797376, 22446884, 21797550, 21797552, 21797377, 21797560,
  21658058, 21658048, 21797548, 21797569, 21797540, 21797525, 21797714, 21797543, 21658035,
]);
/** Categorias da pessoa física pagas pela empresa (financiamento do imóvel MMM, aluguel pessoal): não são dívida da empresa. */
const CAT_PESSOA_FISICA = new Set<number>([21797549, 21796622]);

/** Em que grupo de dívida cai uma conta a pagar em aberto (mesma regra do levantamento de 13/10/2026). */
export function grupoAberto(p: Pick<ParcelaAberta, "idCategoria" | "fornecedor" | "descricao">): GrupoAberto {
  const cat = p.idCategoria;
  const cl = classeDaParcela(cat, p.fornecedor, p.descricao);
  const f = String(p.fornecedor || "").toUpperCase();
  const d = String(p.descricao || "").toUpperCase();
  if ((cat !== null && CAT_PESSOA_FISICA.has(cat)) || /TAXA CORRETOR/.test(d)) return "pessoa_fisica";
  if (cat === 21797541 || cat === 22223057) return "imposto_parcelado";
  if (cl === "TRIBUTO_VENDA" || (cat !== null && [21797555, 21797553, 22039501, 23118518, 23000270].includes(cat))) return "imposto_corrente";
  if (cat === 21797531) { // "Empréstimos" mistura banco, sócios e pessoa física: separa pelo fornecedor e pelo nome
    if (/ADRIANA/.test(f) || /CAPITAL GIRO_JR/.test(d)) return "socios";
    if (/\bPF\b/.test(d)) return "pessoa_fisica"; // empréstimos da pessoa física pagos pela empresa (Mercado Livre, Nubank)
    if (/COSTA JUNIOR/.test(f)) return "outros"; // lançamento a conferir (credor = a própria empresa)
    return "banco";
  }
  if (cat === 21797568 || cat === 22881524 || cat === 21797718 || cat === 21658086) return "banco"; // juros, IOF, cartão, tarifas
  if (cat === 21658110 || cat === 21797526) return "socios"; // empréstimos de sócios e pró-labore
  if (cat === 21797537 || (cat === 21797536 && cl === "DIVIDA")) return "trabalhista";
  if (cat !== null && CAT_FORNECEDOR.has(cat)) {
    if (/TAX\s*ALL/.test(f)) return "fornecedor_contingente";
    if (cl === "DIVIDA") return "acordo_juridico";
    if (cl === "VARIAVEL_OBRA") return "fornecedor_obra";
    return "fornecedor_estrutura";
  }
  if (cl === "DIVIDA") return "acordo_juridico";
  if (cl === "VARIAVEL_OBRA") return "fornecedor_obra";
  if (cl === "FIXA") return "estrutura_fixa";
  return "outros";
}

/** Grupo da aba (imposto/banco/fornecedor/outro) de um grupo de contas em aberto. */
export function grupoDaAba(g: GrupoAberto): GrupoDivida {
  if (g === "imposto_parcelado" || g === "imposto_corrente") return "imposto";
  if (g === "banco") return "banco";
  if (g === "fornecedor_obra" || g === "acordo_juridico" || g === "fornecedor_estrutura" || g === "fornecedor_contingente") return "fornecedor";
  return "outro";
}

// ───────────────────────── leitura ao vivo (com cache) ─────────────────────────
const MESES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const r2 = (v: number) => Math.round(v * 100) / 100;

export type FluxoMes = {
  mes: string; // AAAA-MM
  receita: number; receitaNaoOperacional: number; receitaSemCategoria: number;
  fixa: number; variavel: number; tributo: number; divida: number; outras: number; // outras = repasse PF + não recorrente + sem classe
};

/** Fluxo REALIZADO por mês, igual à tela da Vobi (inclui fatias de rateio). 1 chamada por ano. */
export async function fluxoMensal(anos: number[]): Promise<FluxoMes[]> {
  const st = [2, 3, 4, 7, 8, 9, 10, 11].map((s, k) => `&where[idInstallmentStatus][${k}]=${s}`).join("");
  const out: FluxoMes[] = [];
  for (const ano of anos) {
    const j = await vobiGetJson(`/financial/cashFlow?source=report&where[year]=${ano}&where[ownBusiness]=true${st}`);
    const linhas: any[] = (j?.accomplished || []).filter(Boolean);
    // resposta sem os totais = leitura incompleta: não pode virar um fluxo zerado guardado por 1 h no cache
    if (!linhas.some((r) => r?.type === "incomeTotal") || !linhas.some((r) => r?.type === "expenseTotal")) {
      throw new Error(`A Vobi devolveu o relatório de ${ano} sem os totais de receita e despesa.`);
    }
    const meses: FluxoMes[] = MESES.map((_, i) => ({
      mes: `${ano}-${String(i + 1).padStart(2, "0")}`,
      receita: 0, receitaNaoOperacional: 0, receitaSemCategoria: 0, fixa: 0, variavel: 0, tributo: 0, divida: 0, outras: 0,
    }));
    const somar = (tipo: "income" | "expense", idCat: number | null, i: number, v: number) => {
      const m = meses[i];
      if (tipo === "income") {
        if (!idCat) { m.receitaSemCategoria += v; return; }
        const c = CLASSE_CATEGORIA[idCat];
        if (c === "RECEITA_OPERACIONAL") m.receita += v;
        else if (c === "NEUTRA" || c === "REPASSE_PF") return;
        else m.receitaNaoOperacional += v;
        return;
      }
      const c = idCat ? CLASSE_CATEGORIA[idCat] : undefined;
      if (c === "NEUTRA") return;
      if (c === "FIXA") m.fixa += v;
      else if (c === "VARIAVEL_OBRA") m.variavel += v;
      else if (c === "TRIBUTO_VENDA") m.tributo += v;
      else if (c === "DIVIDA") m.divida += v;
      else m.outras += v;
    };
    const walk = (no: any, tipo: "income" | "expense") => {
      const filhos: any[] = (no.children || []).filter(Boolean);
      const idCat = Number(no.idCategory) || null;
      const semCat = /-0-\d+-0$/.test(String(no.id || ""));
      if (idCat || semCat) {
        for (let i = 0; i < 12; i++) {
          let v = Math.abs(Number(no[MESES[i]]) || 0);
          for (const c of filhos) v -= Math.abs(Number(c[MESES[i]]) || 0);
          if (Math.abs(v) > 0.005) somar(tipo, idCat, i, v);
        }
      }
      for (const c of filhos) walk(c, tipo);
    };
    for (const r of linhas) {
      if (r.type === "incomeTotal") for (const c of (r.children || []).filter(Boolean)) walk(c, "income");
      if (r.type === "expenseTotal") for (const c of (r.children || []).filter(Boolean)) walk(c, "expense");
    }
    for (const m of meses) {
      (Object.keys(m) as Array<keyof FluxoMes>).forEach((k) => { if (k !== "mes") (m as any)[k] = r2((m as any)[k]); });
      out.push(m);
    }
  }
  return out;
}

export type ResumoAberto = {
  /** total/vencido/aVencer/qtd/proximos90 NÃO incluem o grupo "pessoa_fisica" (não é dívida da empresa); porGrupo e porFornecedor incluem. */
  total: number; vencido: number; aVencer: number; qtd: number;
  porGrupo: Array<{ grupo: GrupoAberto; rotulo: string; aba: GrupoDivida; total: number; vencido: number; aVencer: number; qtd: number }>;
  /** vencido = vencimento ANTES de hoje (já passou e não foi pago); aVencer = de hoje em diante (comprometido).
   *  proximoAVencer = vencimento futuro mais próximo (null se nada a vencer); aVencer30 = o que vence nos próximos 30 dias. */
  porFornecedor: Array<{
    fornecedor: string; idFornecedor: number | null; grupo: GrupoAberto; total: number; vencido: number; aVencer: number; qtd: number;
    maisAntigo: string; proximoAVencer: string | null; aVencer30: number;
  }>;
  proximos90: Array<{ mes: string; grupo: GrupoAberto; total: number }>;
};

/** Contas a pagar em aberto (despesas), deduplicadas por id, agrupadas. ~3 chamadas. */
export async function contasAbertas(hojeISO: string): Promise<ResumoAberto> {
  // estrito: leitura cortada na paginação LANÇA (vira "cópia salva com aviso") em vez de virar soma menor — senão
  // a sincronização gravaria vencidos/a vencer faltando parcelas
  const lista = await vencimentosNoPeriodo("2015-01-01", "2040-12-31", { estrito: true, maxPaginas: 20 });
  const vistos = new Set<string>();
  const res: ResumoAberto = { total: 0, vencido: 0, aVencer: 0, qtd: 0, porGrupo: [], porFornecedor: [], proximos90: [] };
  const g = new Map<GrupoAberto, ResumoAberto["porGrupo"][number]>();
  const f = new Map<string, ResumoAberto["porFornecedor"][number]>();
  const p90 = new Map<string, number>();
  const limite90 = new Date(Date.parse(hojeISO + "T00:00:00Z") + 90 * 86400000).toISOString().slice(0, 10);
  const limite30 = new Date(Date.parse(hojeISO + "T00:00:00Z") + 30 * 86400000).toISOString().slice(0, 10);
  for (const p of lista) {
    if (p.tipo !== "despesa" || vistos.has(p.id)) continue;
    vistos.add(p.id);
    const grupo = grupoAberto(p);
    const venc = p.vencimento < hojeISO;
    const daEmpresa = grupo !== "pessoa_fisica";
    if (daEmpresa) {
      res.total += p.valor; res.qtd++;
      if (venc) res.vencido += p.valor; else res.aVencer += p.valor;
    }
    const gg = g.get(grupo) || { grupo, rotulo: ROTULO_GRUPO_ABERTO[grupo], aba: grupoDaAba(grupo), total: 0, vencido: 0, aVencer: 0, qtd: 0 };
    gg.total += p.valor; gg.qtd++; if (venc) gg.vencido += p.valor; else gg.aVencer += p.valor;
    g.set(grupo, gg);
    const nome = (p.fornecedor || p.descricao || "Sem fornecedor").trim();
    const chave = `${grupo}|${p.idFornecedor ?? nome}`;
    const ff = f.get(chave) || {
      fornecedor: nome, idFornecedor: p.idFornecedor, grupo, total: 0, vencido: 0, aVencer: 0, qtd: 0,
      maisAntigo: p.vencimento, proximoAVencer: null as string | null, aVencer30: 0,
    };
    ff.total += p.valor; ff.qtd++;
    if (venc) {
      ff.vencido += p.valor;
    } else {
      ff.aVencer += p.valor;
      if (p.vencimento && (!ff.proximoAVencer || p.vencimento < ff.proximoAVencer)) ff.proximoAVencer = p.vencimento;
      if (p.vencimento && p.vencimento <= limite30) ff.aVencer30 += p.valor;
    }
    if (p.vencimento && p.vencimento < ff.maisAntigo) ff.maisAntigo = p.vencimento;
    f.set(chave, ff);
    if (daEmpresa && !venc && p.vencimento <= limite90) {
      const k = `${p.vencimento.slice(0, 7)}|${grupo}`;
      p90.set(k, (p90.get(k) || 0) + p.valor);
    }
  }
  res.total = r2(res.total); res.vencido = r2(res.vencido); res.aVencer = r2(res.aVencer);
  res.porGrupo = [...g.values()].map((x) => ({ ...x, total: r2(x.total), vencido: r2(x.vencido), aVencer: r2(x.aVencer) })).sort((a, b) => b.total - a.total);
  res.porFornecedor = [...f.values()]
    .map((x) => ({ ...x, total: r2(x.total), vencido: r2(x.vencido), aVencer: r2(x.aVencer), aVencer30: r2(x.aVencer30) }))
    .sort((a, b) => b.total - a.total);
  res.proximos90 = [...p90.entries()].map(([k, total]) => { const [mes, grupo] = k.split("|"); return { mes, grupo: grupo as GrupoAberto, total: r2(total) }; })
    .sort((a, b) => a.mes.localeCompare(b.mes) || b.total - a.total);
  return res;
}

/** Soma das contas em aberto de UM fornecedor da Vobi (todas as categorias dele). As de pessoa física só entram
 *  quando a linha da dívida é ela mesma de pessoa física (senão a dívida da empresa ficaria inflada). */
export function somaFornecedorVobi(aberto: ResumoAberto, idFornecedor: number, incluirPessoaFisica: boolean): {
  achou: boolean; vencido: number; aVencer: number; aVencer30: number; proximoAVencer: string | null;
} {
  const r = { achou: false, vencido: 0, aVencer: 0, aVencer30: 0, proximoAVencer: null as string | null };
  for (const x of aberto.porFornecedor || []) {
    if (x.idFornecedor !== idFornecedor) continue;
    if (x.grupo === "pessoa_fisica" && !incluirPessoaFisica) continue;
    r.achou = true;
    r.vencido += Number(x.vencido) || 0;
    r.aVencer += Number(x.aVencer) || 0;
    r.aVencer30 += Number(x.aVencer30) || 0;
    if (x.proximoAVencer && (!r.proximoAVencer || x.proximoAVencer < r.proximoAVencer)) r.proximoAVencer = x.proximoAVencer;
  }
  return { ...r, vencido: r2(r.vencido), aVencer: r2(r.aVencer), aVencer30: r2(r.aVencer30) };
}

export type DadosAoVivo = {
  atualizadoEm: string; fonte: "vobi" | "cache";
  /** problema na leitura (a página mostra em amarelo) */
  aviso?: string;
  /** informação sem problema (ex.: "atualizado há menos de 3 minutos") */
  nota?: string;
  fluxo: FluxoMes[]; aberto: ResumoAberto | null;
};

// v3: porFornecedor ganhou proximoAVencer e aVencer30 (vencido x comprometido, 14/10/2026); a cópia v2 não tem.
const CHAVE_CACHE = "sf:aovivo:v3";
const TTL_MS = 60 * 60 * 1000;
/** "Atualizar da Vobi" repetido dentro deste intervalo devolve a mesma leitura (poupa a cota de 1000/h). */
const PISO_FORCAR_MS = 3 * 60 * 1000;

function hojeSP(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Leitura da Vobi em andamento nesta instância: duas abas abertas ao mesmo tempo reaproveitam a mesma. */
let emCurso: Promise<DadosAoVivo> | null = null;

async function lerDaVobiESalvar(): Promise<DadosAoVivo> {
  const hoje = hojeSP();
  const ano = Number(hoje.slice(0, 4));
  const fluxo = await fluxoMensal([ano - 1, ano]);
  const aberto = await contasAbertas(hoje);
  const dados: DadosAoVivo = { atualizadoEm: new Date().toISOString(), fonte: "vobi", fluxo, aberto };
  try {
    await supabaseAdmin().from("vobi_cache").upsert({ chave: CHAVE_CACHE, dados, atualizado_em: dados.atualizadoEm }, { onConflict: "chave" });
  } catch { /* cache é opcional */ }
  return dados;
}

/** Dados ao vivo da Vobi com cache de 1 h em vobi_cache. Se a Vobi recusar (cota/erro), devolve a última cópia salva com aviso. */
export async function dadosAoVivo(forcar = false): Promise<DadosAoVivo> {
  const db = supabaseAdmin();
  let salvo: { dados: DadosAoVivo; atualizado_em: string } | null = null;
  try {
    const { data } = await db.from("vobi_cache").select("dados, atualizado_em").eq("chave", CHAVE_CACHE).maybeSingle();
    if (data?.dados) salvo = data as any;
  } catch { /* sem cache */ }
  const idade = salvo ? Date.now() - Date.parse(salvo.atualizado_em) : Infinity;
  if (salvo && !forcar && idade < TTL_MS) {
    return { ...salvo.dados, fonte: "cache" };
  }
  if (salvo && forcar && idade < PISO_FORCAR_MS) {
    return {
      ...salvo.dados, fonte: "cache",
      nota: "A Vobi foi lida há menos de 3 minutos; mostrando a mesma leitura para poupar o limite de consultas.",
    };
  }
  if (!vobiConfigurado()) {
    if (salvo) return { ...salvo.dados, fonte: "cache", aviso: "Credenciais da Vobi não configuradas; mostrando a última cópia." };
    throw new Error("Credenciais da Vobi não configuradas.");
  }
  try {
    if (!emCurso) emCurso = lerDaVobiESalvar().finally(() => { emCurso = null; });
    return await emCurso;
  } catch (e: any) {
    const msg = String(e?.message || e);
    const ehCota = e instanceof VobiCotaError || e?.cota === true || /HTTP 429/.test(msg);
    const espera = e instanceof VobiCotaError && e.esperaSeg ? ` Ela libera de novo em cerca de ${Math.ceil(e.esperaSeg / 60)} min.` : "";
    const aviso = ehCota
      ? `A Vobi atingiu o limite de consultas desta hora.${espera} Mostrando a última cópia salva.`
      : `Não consegui ler a Vobi agora (${msg.slice(0, 120)}). Mostrando a última cópia salva.`;
    if (salvo) return { ...salvo.dados, fonte: "cache", aviso };
    if (e instanceof VobiCotaError) throw e; // a API lê os minutos de espera (esperaSeg)
    throw new Error(ehCota ? "A Vobi atingiu o limite de consultas desta hora e ainda não há cópia salva. Tente mais tarde." : msg);
  }
}

// ───────────────────────── contas do ponto de equilíbrio ─────────────────────────
/** faturamento necessário = custo mensal / (margem de contribuição − tributo sobre faturamento). Percentuais em 0-1. */
export function faturamentoNecessario(custoMensal: number, margem: number, tributo: number): number | null {
  const sobra = margem - tributo;
  if (!(sobra > 0)) return null;
  return Math.round(custoMensal / sobra);
}
