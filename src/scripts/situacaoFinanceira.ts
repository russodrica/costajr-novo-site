// Script da aba Situação Financeira (/admin/situacao-financeira).
// Módulo próprio (o <script> grande direto na página some do SSR — ver ativoDetalhe.ts).
// Lê os dados do banco pelo island JSON #sfData e busca a parte ao vivo da Vobi em
// GET /api/admin/situacao-financeira/aovivo (cache de 1 h no servidor; ?forcar=1 refaz).
// Gravações: PATCH .../acoes/{id}, .../protestos/{id}, .../dividas/{id} (content-type JSON: CSRF do Astro).
// Só `import type` do lib: nada do servidor (supabase) entra no pacote do navegador.
import type { SfDivida, SfProtesto, SfAcao, DadosAoVivo, FluxoMes, ResumoAberto } from "../lib/situacaoFinanceira";

// ───────────────────────── tipos do painel (fin_sf_painel.dados) ─────────────────────────
type Num = number | string | null | undefined;
type GrupoResumo = {
  valor?: Num; nota?: string; piso?: Num; teto?: Num; parcela_contratual_mes?: Num; pago_medio_mes?: Num;
  total?: Num; vencido?: Num; protestado?: Num;
  /** fornecedores sem o honorário contingente da Tax All (é o que entra no piso da dívida) */
  sem_contingente?: Num;
  /** soma das linhas da tabela do grupo quando o seed gravou (para mostrar o efeito das edições feitas na tela) */
  soma_linhas?: Num;
};
type Degrau = { patamar?: string; valor_rs?: Num; conta?: string; quando?: string };
type Semana = {
  semana?: Num; datas?: string; foco?: string; ideias_ativas?: unknown[]; contatos?: Num; conversas?: Num; visitas?: Num;
  propostas?: Num; fechamentos?: Num; vendido_rs?: Num; caixa_entrando_rs?: Num; recorrente_acumulado_rs?: Num; entregas?: unknown[];
};
type PlanoVendas = {
  periodo?: string; objetivo?: string;
  nichos_foco?: { semanas_1_a_4?: unknown[]; semanas_5_a_8?: unknown[]; regra?: string };
  funil?: { etapas?: unknown[]; premissas_de_conversao?: Record<string, unknown> };
  cadencia_por_alvo?: unknown[]; papeis?: Record<string, unknown>; semanas?: Semana[];
  totais_8_semanas?: Record<string, unknown>; reuniao_de_segunda?: string; indicadores?: unknown[];
  gatilhos_de_corte?: unknown[]; fontes?: unknown[];
};
/** vira_caixa: true = dinheiro que entra; false = crédito de imposto (abate dívida, não entra no caixa); "talvez" = depende de decisão */
type Credito = { titulo?: string; valor?: unknown; data?: string; observacao?: string; vira_caixa?: boolean | string };
type Painel = {
  resumo_dividas?: {
    data_ref?: string; total_piso?: Num; total_teto?: Num;
    grupos?: { imposto?: GrupoResumo; banco?: GrupoResumo; fornecedor?: GrupoResumo; outro?: GrupoResumo };
  };
  numeros_chave?: Array<{ titulo?: string; valor?: unknown; detalhe?: string; tom?: string }>;
  meta?: {
    valor?: Num; texto?: string; conta?: string; margem?: Num; tributo?: Num; fixo_mensal?: Num; divida_mensal?: Num;
    degraus?: Degrau[]; nao_inclui?: string; premissas_a_confirmar?: unknown[];
  };
  creditos?: Array<Credito>;
  despesas_fixas?: {
    data_ref?: string; total_mensal?: Num; realizado_medio_jul_set?: Num;
    itens?: Array<{ nome?: string; categoria?: string; valor?: Num }>; observacao?: string;
  };
  plano_vendas?: PlanoVendas;
  alertas?: Array<{ titulo?: string; texto?: string }>;
  lacunas?: unknown[];
  resumo_plano?: {
    data?: string; ideias_finais?: Num; ideias_ativas?: Num; descartadas?: Num;
    por_onda?: Record<string, Num>; criterios_ondas?: Record<string, string>;
  };
  o_que_fazer?: { imposto?: unknown[]; banco?: unknown[]; fornecedor?: unknown[] };
};
type Ilha = {
  faltaMigration: boolean; erro: string | null;
  dividas: SfDivida[]; protestos: SfProtesto[]; acoes: SfAcao[]; painel: Painel;
  statusAcao: string[]; rotuloStatus: Record<string, string>; rotuloGrupoAberto: Record<string, string>;
  podeEditar: boolean;
};
type PorFornecedor = ResumoAberto["porFornecedor"][number];
type RascunhoAcao = { status?: string; responsavel?: string; prazo?: string; notas?: string };
type Msg = { ok: boolean; texto: string };

// ───────────────────────── utilidades ─────────────────────────
function el(id: string): HTMLElement | null { return document.getElementById(id); }
function txt(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try { return JSON.stringify(v); } catch { return String(v); }
}
function esc(v: unknown): string {
  return txt(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}
function n0(v: unknown): number { return num(v) ?? 0; }
function arr<T = unknown>(v: unknown): T[] { return Array.isArray(v) ? (v as T[]) : []; }
const FMT_R = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const FMT_N = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
function fmtR(v: unknown): string { const n = num(v); return n == null ? "—" : FMT_R.format(n); }
function fmtN(v: unknown): string { const n = num(v); return n == null ? "—" : FMT_N.format(n); }
function fmtPct(v: number): string { return FMT_N.format(Math.round(v * 10) / 10) + "%"; }
function fmtData(v: unknown): string {
  const s = txt(v).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (s || "—");
}
function valorLivre(v: unknown): string {
  if (typeof v === "number") return Math.abs(v) >= 100 ? FMT_R.format(v) : FMT_N.format(v);
  return txt(v) || "—";
}
function norm(s: unknown): string {
  return txt(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(ltda|eireli|epp|mei|me|sa|s a|cia)\b/g, " ")
    .replace(/\s+/g, " ").trim();
}
function rotuloChave(k: string): string {
  const s = k.replace(/_/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function primeiraMaiuscula(s: string): string { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function linkSeguro(u: unknown): string {
  const s = txt(u).trim();
  if (!/^https?:\/\//i.test(s)) return esc(s);
  return `<a href="${esc(s)}" target="_blank" rel="noopener noreferrer">${esc(s.replace(/^https?:\/\/(www\.)?/i, "").slice(0, 70))}</a>`;
}
function lista(itens: unknown[], ordenada = false, cls = "sf-lista"): string {
  const li = itens.map((x) => `<li>${esc(x)}</li>`).join("");
  if (!li) return "";
  return ordenada ? `<ol class="${cls}">${li}</ol>` : `<ul class="${cls}">${li}</ul>`;
}
function hojeISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const MES_ABREV = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
function rotuloMes(ym: string): string {
  const [a, m] = ym.split("-");
  return `${MES_ABREV[Number(m) - 1] || m}/${String(a || "").slice(2)}`;
}
function horaDe(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
function diaDe(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
function lsGet(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k: string, v: string): void { try { localStorage.setItem(k, v); } catch { /* sem storage */ } }

// ───────────────────────── estado ─────────────────────────
function lerIlha(): Ilha {
  const vazio: Ilha = {
    faltaMigration: false, erro: null, dividas: [], protestos: [], acoes: [], painel: {},
    statusAcao: ["ideia", "testando", "em_andamento", "feito", "descartado"],
    rotuloStatus: { ideia: "Ideia", testando: "Testando", em_andamento: "Em andamento", feito: "Feito", descartado: "Descartado" },
    rotuloGrupoAberto: {}, podeEditar: false,
  };
  try {
    const bruto = JSON.parse(el("sfData")?.textContent || "{}") as Partial<Ilha>;
    return {
      ...vazio, ...bruto,
      dividas: arr<SfDivida>(bruto.dividas), protestos: arr<SfProtesto>(bruto.protestos), acoes: arr<SfAcao>(bruto.acoes),
      painel: (bruto.painel && typeof bruto.painel === "object" ? bruto.painel : {}) as Painel,
      statusAcao: arr<string>(bruto.statusAcao).length ? arr<string>(bruto.statusAcao) : vazio.statusAcao,
      rotuloStatus: { ...vazio.rotuloStatus, ...(bruto.rotuloStatus || {}) },
      rotuloGrupoAberto: bruto.rotuloGrupoAberto || {},
    };
  } catch {
    return vazio;
  }
}
const D: Ilha = lerIlha();
let vivo: DadosAoVivo | null = null;
let vivoErro = "";
let vivoCarregando = false;
let vivoTentado = false; // até a 1ª resposta, as partes ao vivo mostram "carregando" (não erro)
function aguardandoVivo(): boolean { return !vivo && (vivoCarregando || !vivoTentado); }

const rascAcao: Record<string, RascunhoAcao> = {};
const msgAcao: Record<string, Msg> = {};
const rascProt: Record<string, string> = {};
const msgProt: Record<string, Msg> = {};

type Filtros = {
  onda: string; dificuldade: string; investimento: string; status: string; busca: string; descartadas: boolean;
  protTab: string; protGrupo: string; protBusca: string; fornBusca: string; fornOrdem: string;
};
const filtros: Filtros = {
  onda: "", dificuldade: "", investimento: "", status: "", busca: "", descartadas: false,
  protTab: "", protGrupo: "", protBusca: "", fornBusca: "", fornOrdem: "total",
};
try {
  const salvo = JSON.parse(lsGet("sf:filtros") || "null") as Partial<Filtros> | null;
  if (salvo && typeof salvo === "object") {
    for (const k of Object.keys(filtros) as Array<keyof Filtros>) {
      const v = salvo[k];
      if (k === "descartadas") { if (typeof v === "boolean") filtros.descartadas = v; }
      else if (typeof v === "string") (filtros as Record<string, unknown>)[k] = v;
    }
  }
} catch { /* filtros padrão */ }
function salvarFiltros(): void { lsSet("sf:filtros", JSON.stringify(filtros)); }
/** Filtro guardado com um valor que não existe mais nas opções (ex.: dados semeados de novo) volta para "todos". */
function validarFiltro(k: "onda" | "dificuldade" | "investimento" | "status" | "protTab" | "protGrupo" | "fornOrdem", opcoes: string[], padrao = ""): void {
  if (filtros[k] && !opcoes.includes(filtros[k])) { filtros[k] = padrao; salvarFiltros(); }
}

// ───────────────────────── rótulos e selos ─────────────────────────
const COR = { imposto: "#B91C1C", banco: "#1D4ED8", fornecedor: "#EA580C", outro: "#7C3AED" } as const;
const SITUACOES: Record<string, [string, string]> = {
  inscrita: ["Em dívida ativa", "orange"],
  intimada: ["Intimada", "yellow"],
  protestada: ["Protestada", "red"],
  ajuizada: ["Ajuizada (na Justiça)", "red"],
  execucao: ["Em execução", "red"],
  citada: ["Citada", "red"],
  atrasada: ["Atrasada", "orange"],
  em_dia: ["Em dia", "green"],
  acordo: ["Em acordo", "blue"],
  negociacao: ["Em negociação", "purple"],
};
function chaveSituacao(s: unknown): string {
  return txt(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim().replace(/[\s-]+/g, "_");
}
function badgeSituacao(s: unknown): string {
  const t = txt(s).trim();
  if (!t) return `<span class="sf-muted">—</span>`;
  const conhecido = SITUACOES[chaveSituacao(t)];
  return conhecido
    ? `<span class="badge badge-${conhecido[1]}">${esc(conhecido[0])}</span>`
    : `<span class="badge badge-gray">${esc(t)}</span>`;
}
const CONFIANCA: Record<string, [string, string]> = {
  confirmado: ["Confirmado", "green"], provavel: ["Provável", "yellow"], nao_identificado: ["Não identificado", "gray"],
};
function badgeConfianca(s: unknown): string {
  const t = txt(s).trim();
  if (!t) return `<span class="sf-muted">—</span>`;
  const c = CONFIANCA[chaveSituacao(t)];
  return c ? `<span class="badge badge-${c[1]}">${esc(c[0])}</span>` : `<span class="badge badge-gray">${esc(t)}</span>`;
}
const SECOES_PROT: Array<[string, string]> = [
  ["protestado_cenprot", "Protestados (CENPROT)"],
  ["pgfn_intimado", "PGFN — intimados para protesto"],
  ["fora_da_cenprot", "Fora da CENPROT"],
];
const STATUS_COR: Record<string, string> = { ideia: "gray", testando: "yellow", em_andamento: "blue", feito: "green", descartado: "red" };
function badgeStatus(s: string): string {
  return `<span class="badge badge-${STATUS_COR[s] || "gray"}">${esc(D.rotuloStatus[s] || s)}</span>`;
}
const DIFICULDADE: Record<string, string> = { facil: "Fácil", media: "Média", medio: "Média", dificil: "Difícil" };
const GRUPO_IDEIA: Record<string, string> = {
  ativos_e_creditos_parados: "Dinheiro parado e créditos",
  vendas_e_prospeccao: "Vendas e prospecção",
  recorrencia_e_manutencao: "Recorrência e manutenção",
  modelos_sem_capital: "Modelos sem capital",
  servicos_tecnicos_e_laudos: "Serviços técnicos e laudos",
  parcerias_e_canais: "Parcerias e canais",
  produto_digital_e_conhecimento: "Produto digital e conhecimento",
};
const ONDA_COR: Record<number, string> = { 1: "green", 2: "blue", 3: "purple" };

// ───────────────────────── dados derivados ─────────────────────────
function dividasDo(grupo: string): SfDivida[] { return D.dividas.filter((d) => d.grupo === grupo); }
function somaValor(l: SfDivida[]): number { return l.reduce((s, d) => s + n0(d.valor), 0); }
function somaTeto(l: SfDivida[]): number { return l.reduce((s, d) => s + (num(d.valor_teto) ?? n0(d.valor)), 0); }
function somaParcela(l: SfDivida[]): number { return l.reduce((s, d) => s + n0(d.parcela_mensal), 0); }

function fornecedorVivo(): { total: number; vencido: number; aVencer: number; qtd: number } | null {
  const ab = vivo?.aberto;
  if (!ab) return null;
  const r = { total: 0, vencido: 0, aVencer: 0, qtd: 0 };
  for (const g of ab.porGrupo) {
    if (g.aba !== "fornecedor") continue;
    r.total += n0(g.total); r.vencido += n0(g.vencido); r.aVencer += n0(g.aVencer); r.qtd += n0(g.qtd);
  }
  return r;
}
function fluxoFechado(): FluxoMes[] {
  if (!vivo) return [];
  const atual = hojeISO().slice(0, 7);
  return arr<FluxoMes>(vivo.fluxo).filter((m) => m && typeof m.mes === "string" && m.mes < atual)
    .sort((a, b) => a.mes.localeCompare(b.mes));
}
function mediaReceita(n: number): { valor: number; de: string; ate: string } | null {
  const f = fluxoFechado().slice(-n);
  if (!f.length) return null;
  const v = f.reduce((s, m) => s + n0(m.receita), 0) / f.length;
  return { valor: v, de: f[0].mes, ate: f[f.length - 1].mes };
}
/** Protesto que está no CPF da sócia (não no CNPJ da empresa). */
function protestoNoCpf(p: SfProtesto): boolean { return /CPF DA (ADRIANA|S[OÓ]CIA)/i.test(txt(p.observacao)); }
/** Título que a Vobi registra como pago (pode faltar só cancelar o protesto). */
function protestoPago(p: SfProtesto): boolean { return /^pago/i.test(txt(p.situacao_vobi).trim()); }
let protestosNorm: string[] | null = null;
function ehProtestado(nome: string): boolean {
  if (!protestosNorm) {
    // ignora os do CPF da sócia (ex.: Enel) e os já pagos: não são protesto em aberto contra a empresa
    protestosNorm = [...new Set(D.protestos.filter((p) => !protestoNoCpf(p) && !protestoPago(p))
      .map((p) => norm(p.credor)).filter((c) => c.length >= 4))];
  }
  const n = norm(nome);
  if (n.length < 4) return false;
  return protestosNorm.some((c) => n.includes(c) || c.includes(n));
}

// ───────────────────────── blocos reutilizáveis ─────────────────────────
function blkTitulo(icone: string, titulo: string, extra = ""): string {
  return `<p class="sf-blk-title"><i class="ti ti-${icone}" aria-hidden="true"></i> ${esc(titulo)} ${extra}</p>`;
}
function quadroFazer(chave: "imposto" | "banco" | "fornecedor"): string {
  const itens = arr(D.painel.o_que_fazer?.[chave]);
  if (!itens.length) return "";
  return `<div class="sf-fazer sf-blk"><h4>O que fazer</h4>${lista(itens, true, "")}</div>`;
}
function avisoVivo(): string {
  if (aguardandoVivo()) return `<div class="loading"><span class="spinner"></span> Buscando as contas em aberto na Vobi…</div>`;
  if (!vivo) return `<div class="sf-box sf-box-amarelo"><strong>Não consegui ler a Vobi.</strong>${esc(vivoErro || "Tente o botão “Atualizar da Vobi”.")}</div>`;
  return "";
}
function botaoEditar(id: string): string {
  if (!D.podeEditar) return "";
  return `<button type="button" class="sf-ed" title="Atualizar" aria-label="Atualizar" data-requer-edicao data-sf-act="editar-divida" data-id="${esc(id)}">✎</button>`;
}
function celValor(d: SfDivida): string {
  const v = num(d.valor), t = num(d.valor_teto), p = num(d.parcela_mensal);
  let h = v == null ? `<span class="sf-muted">—</span>` : esc(fmtR(v));
  if (t != null && t !== v) h += `<div class="sf-muted">até ${esc(fmtR(t))}</div>`;
  if (p) h += `<div class="sf-muted">${esc(fmtR(p))} por mês</div>`;
  return h;
}

/** Quadro AO VIVO das contas em aberto na Vobi para os grupos pedidos. `nota` = aviso de leitura em destaque (amarelo). */
function quadroVivo(grupos: string[], titulo: string, nota = ""): string {
  const aviso = avisoVivo();
  let corpo = aviso;
  const ab = vivo?.aberto;
  if (!aviso && !ab) corpo = `<p class="sf-muted">A Vobi não devolveu as contas em aberto nesta leitura.</p>`;
  if (!aviso && ab) {
    const gs = ab.porGrupo.filter((g) => grupos.includes(g.grupo));
    if (!gs.length) {
      corpo = `<p class="sf-muted">Nenhuma conta em aberto na Vobi neste grupo.</p>`;
    } else {
      const tot = gs.reduce((s, g) => ({ v: s.v + n0(g.vencido), a: s.a + n0(g.aVencer), t: s.t + n0(g.total), q: s.q + n0(g.qtd) }), { v: 0, a: 0, t: 0, q: 0 });
      const linhas = gs.map((g) => `<tr><td><strong>${esc(g.rotulo || D.rotuloGrupoAberto[g.grupo] || g.grupo)}</strong></td>
        <td class="sf-num sf-neg">${esc(fmtR(g.vencido))}</td><td class="sf-num">${esc(fmtR(g.aVencer))}</td>
        <td class="sf-num"><strong>${esc(fmtR(g.total))}</strong></td><td class="sf-num">${esc(fmtN(g.qtd))}</td></tr>`).join("");
      const forn = ab.porFornecedor.filter((f) => grupos.includes(f.grupo));
      const det = forn.length ? `<details class="sf-det" style="margin-top:12px"><summary>Ver conta por conta (${forn.length})</summary>
        <div class="table-wrap"><table class="sf-table"><thead><tr><th>Quem recebe</th><th class="sf-num">Vencido</th><th class="sf-num">A vencer</th><th class="sf-num">Total</th><th class="sf-num">Contas</th><th>Mais antiga</th></tr></thead>
        <tbody>${forn.map((f) => `<tr><td>${esc(f.fornecedor)}</td><td class="sf-num sf-neg">${esc(fmtR(f.vencido))}</td><td class="sf-num">${esc(fmtR(f.aVencer))}</td><td class="sf-num">${esc(fmtR(f.total))}</td><td class="sf-num">${esc(fmtN(f.qtd))}</td><td>${esc(fmtData(f.maisAntigo))}</td></tr>`).join("")}</tbody></table></div></details>` : "";
      corpo = `<div class="table-wrap"><table class="sf-table"><thead><tr><th>Grupo</th><th class="sf-num">Vencido</th><th class="sf-num">A vencer</th><th class="sf-num">Total</th><th class="sf-num">Contas</th></tr></thead>
        <tbody>${linhas}</tbody>
        <tfoot><tr><td>Total</td><td class="sf-num">${esc(fmtR(tot.v))}</td><td class="sf-num">${esc(fmtR(tot.a))}</td><td class="sf-num">${esc(fmtR(tot.t))}</td><td class="sf-num">${esc(fmtN(tot.q))}</td></tr></tfoot></table></div>${det}`;
    }
  }
  return `<div class="card sf-blk"><div class="sf-card-t">${esc(titulo)} <span class="sf-tag-vivo">ao vivo</span></div>
    ${nota ? `<div class="sf-box sf-box-amarelo" style="margin-bottom:12px">${esc(nota)}</div>` : ""}${corpo}
    <p class="sf-nota">Contas lançadas na Vobi e ainda não pagas. “Vencido” = a data de vencimento já passou.</p></div>`;
}

/** Tabela simples de dívidas (fornecedores do levantamento e “outros”). */
function tabelaSimples(l: SfDivida[]): string {
  if (!l.length) return `<p class="sf-muted">Nada cadastrado neste grupo.</p>`;
  const linhas = l.map((d) => `<tr>
    <td><strong>${esc(d.credor)}</strong>${d.natureza ? `<div class="sf-muted">${esc(d.natureza)}</div>` : ""}${d.identificacao ? `<div class="sf-muted">${esc(d.identificacao)}</div>` : ""}${d.retido ? `<div><span class="sf-selo-retido">Retido – risco penal</span></div>` : ""}</td>
    <td class="sf-num">${celValor(d)}</td>
    <td>${badgeSituacao(d.situacao)}${d.data_ref ? `<div class="sf-muted">${esc(fmtData(d.data_ref))}</div>` : ""}</td>
    <td class="sf-obs">${esc(d.risco || "")}</td>
    <td class="sf-obs">${esc(d.observacao || "")}</td>
    <td>${botaoEditar(d.id)}</td></tr>`).join("");
  return `<div class="table-wrap"><table class="sf-table"><thead><tr><th>Credor</th><th class="sf-num">Valor</th><th>Situação</th><th>Risco</th><th>Observação</th><th></th></tr></thead>
    <tbody>${linhas}</tbody>
    <tfoot><tr><td>Total (${l.length})</td><td class="sf-num">${esc(fmtR(somaValor(l)))}${somaTeto(l) !== somaValor(l) ? `<div class="sf-muted">até ${esc(fmtR(somaTeto(l)))}</div>` : ""}</td><td colspan="4"></td></tr></tfoot></table></div>`;
}

// ───────────────────────── 1. Visão geral ─────────────────────────
type ChaveGrupo = "imposto" | "banco" | "fornecedor" | "outro";
/** Os cartões mostram o levantamento (fixo). Se a tabela do grupo foi editada na tela, avisa quanto ela soma agora. */
function linhaEdicoes(grupo: ChaveGrupo, onde: string): string {
  const base = num(D.painel.resumo_dividas?.grupos?.[grupo]?.soma_linhas);
  if (base == null) return "";
  const atual = somaValor(dividasDo(grupo));
  const dif = atual - base;
  if (Math.abs(dif) < 0.01) return "";
  return `<div class="sf-gcard-edit">Com as suas atualizações, a tabela ${esc(onde)} soma ${esc(fmtR(atual))} (${dif > 0 ? "+" : "−"}${esc(fmtR(Math.abs(dif)))} desde o levantamento).</div>`;
}
function renderVisao(): void {
  const sec = el("sfSecVisao");
  if (!sec) return;
  const g = D.painel.resumo_dividas?.grupos || {};
  const dataRef = txt(D.painel.resumo_dividas?.data_ref);
  const ref = `<div class="sf-gcard-ref">Levantamento${dataRef ? " de " + esc(dataRef) : ""} (não muda com as edições)</div>`;
  const imposto = num(g.imposto?.valor) ?? somaValor(dividasDo("imposto"));
  const bancoPiso = num(g.banco?.piso) ?? somaValor(dividasDo("banco"));
  const bancoTeto = num(g.banco?.teto) ?? somaTeto(dividasDo("banco"));
  const fornTotal = num(g.fornecedor?.total) ?? somaValor(dividasDo("fornecedor"));
  const fornSemCont = num(g.fornecedor?.sem_contingente) ?? fornTotal;
  const fornVencido = num(g.fornecedor?.vencido);
  const fornProt = num(g.fornecedor?.protestado);
  const fv = fornecedorVivo();
  const outro = num(g.outro?.valor) ?? somaValor(dividasDo("outro"));

  // (a) cartões por grupo — o número grande é sempre o do levantamento; o ao vivo da Vobi vem numa 2ª linha
  const parcelaBanco = num(g.banco?.parcela_contratual_mes);
  const pagoBanco = num(g.banco?.pago_medio_mes);
  const vivoForn = fv
    ? `<div class="sf-gcard-vivo"><span class="sf-tag-vivo">ao vivo</span> Na Vobi agora: <strong>${esc(fmtR(fv.total))}</strong> · vencido ${esc(fmtR(fv.vencido))}</div>`
    : (aguardandoVivo() ? `<div class="sf-gcard-vivo sf-muted">Buscando o valor de hoje na Vobi…</div>` : "");
  const cards = `
    <div class="sf-grupos">
      <div class="sf-gcard" style="--c:${COR.imposto}" data-sf-act="ir-aba" data-aba="impostos" role="button" tabindex="0">
        <div class="sf-gcard-head"><span class="sf-gcard-ic"><i class="ti ti-receipt-tax" aria-hidden="true"></i></span><span class="sf-gcard-nome">Impostos</span></div>
        <div class="sf-gcard-v">${esc(fmtR(imposto))}</div>
        ${ref}
        ${linhaEdicoes("imposto", "da aba Impostos")}
        <div class="sf-gcard-txt">${esc(g.imposto?.nota || "União (PGFN e Receita), Prefeitura e Estado.")}</div>
      </div>
      <div class="sf-gcard" style="--c:${COR.banco}" data-sf-act="ir-aba" data-aba="bancos" role="button" tabindex="0">
        <div class="sf-gcard-head"><span class="sf-gcard-ic"><i class="ti ti-building-bank" aria-hidden="true"></i></span><span class="sf-gcard-nome">Bancos</span></div>
        <div class="sf-gcard-v">${esc(fmtR(bancoPiso))}</div>
        ${bancoTeto && bancoTeto !== bancoPiso ? `<div class="sf-gcard-v2">pode chegar a ${esc(fmtR(bancoTeto))}</div>` : ""}
        ${parcelaBanco != null || pagoBanco != null ? `<div class="sf-gcard-v2">Parcela do contrato: ${esc(fmtR(parcelaBanco))}/mês · pago em média: ${esc(fmtR(pagoBanco))}/mês</div>` : ""}
        ${ref}
        ${linhaEdicoes("banco", "da aba Bancos")}
        <div class="sf-gcard-txt">${esc(g.banco?.nota || "")}</div>
      </div>
      <div class="sf-gcard" style="--c:${COR.fornecedor}" data-sf-act="ir-aba" data-aba="fornecedores" role="button" tabindex="0">
        <div class="sf-gcard-head"><span class="sf-gcard-ic"><i class="ti ti-truck" aria-hidden="true"></i></span><span class="sf-gcard-nome">Fornecedores</span></div>
        <div class="sf-gcard-v">${esc(fmtR(fornTotal))}</div>
        ${fornVencido != null ? `<div class="sf-gcard-v2">Vencido: ${esc(fmtR(fornVencido))}${fornProt ? ` · protestado: ${esc(fmtR(fornProt))}` : ""}</div>` : ""}
        ${ref}
        ${vivoForn}
        <div class="sf-gcard-txt">${esc(g.fornecedor?.nota || "")}</div>
      </div>
      <div class="sf-gcard" style="--c:${COR.outro}" data-sf-act="ir-outros" role="button" tabindex="0">
        <div class="sf-gcard-head"><span class="sf-gcard-ic"><i class="ti ti-scale" aria-hidden="true"></i></span><span class="sf-gcard-nome">Outros</span></div>
        <div class="sf-gcard-v">${esc(fmtR(outro))}</div>
        ${ref}
        <div class="sf-gcard-txt">${esc(g.outro?.nota || "Trabalhista, FGTS e acordos.")}</div>
      </div>
    </div>`;

  // (b) composição — tudo do levantamento (fixo), com os fornecedores SEM a Tax All, para fechar com o piso
  const partes = [
    { nome: "Impostos", v: imposto, cor: COR.imposto },
    { nome: "Bancos (valor mínimo)", v: bancoPiso, cor: COR.banco },
    { nome: fornSemCont !== fornTotal ? "Fornecedores (sem a Tax All)" : "Fornecedores", v: fornSemCont, cor: COR.fornecedor },
    { nome: "Outros", v: outro, cor: COR.outro },
  ].filter((p) => p.v > 0);
  const somaPartes = partes.reduce((s, p) => s + p.v, 0);
  const totPiso = num(D.painel.resumo_dividas?.total_piso);
  const totTeto = num(D.painel.resumo_dividas?.total_teto);
  const composicao = somaPartes > 0 ? `
    <div class="card sf-blk">
      <div class="sf-card-t">Do que é feita a dívida <span class="sf-tag-salvo">levantamento${dataRef ? " " + esc(dataRef) : ""}</span></div>
      <p class="sf-small" style="margin-bottom:10px">Soma das partes: <strong>${esc(fmtR(somaPartes))}</strong>${totPiso != null ? ` · dívida total: <strong>${esc(fmtR(totPiso))}</strong>${totTeto != null && totTeto !== totPiso ? ` a <strong>${esc(fmtR(totTeto))}</strong>` : ""}` : ""}</p>
      <div class="sf-stack">${partes.map((p) => {
        const pct = (p.v / somaPartes) * 100;
        return `<div class="sf-stack-seg" style="width:${pct.toFixed(3)}%;background:${p.cor}" title="${esc(p.nome)}: ${esc(fmtR(p.v))} (${esc(fmtPct(pct))})">${pct >= 8 ? esc(fmtPct(pct)) : ""}</div>`;
      }).join("")}</div>
      <div class="sf-leg">${partes.map((p) => `<span class="sf-leg-i"><span class="sf-dot" style="background:${p.cor}"></span>${esc(p.nome)}: <strong>${esc(fmtPct((p.v / somaPartes) * 100))}</strong> (${esc(fmtR(p.v))})</span>`).join("")}</div>
      <p class="sf-nota">Números do levantamento: não mudam quando você edita uma dívida. Os bancos entram pelo valor mínimo e os fornecedores sem o honorário da Tax All, que só é devido se o crédito for compensado.</p>
    </div>` : "";

  sec.innerHTML = `
    <div class="sf-blk">${blkTitulo("chart-pie", "A dívida por grupo")}${cards}</div>
    ${composicao}
    ${blocoMeta()}
    ${blocoNumeros()}
    ${blocoCreditos()}
    ${blocoAbertoVivo()}
    ${blocoOutros()}
    ${blocoAlertas()}`;
}

function blocoMeta(): string {
  const m = D.painel.meta;
  if (!m) return "";
  const todos = arr<Degrau>(m.degraus).filter((d) => num(d.valor_rs) != null);
  // degrau marcado como "não é viável" fica só em texto: na escala, ele esmagaria as barras dos outros
  const inviavel = (d: Degrau) => /n[aã]o [eé] vi[aá]vel/i.test(`${txt(d.quando)} ${txt(d.patamar)}`);
  const degraus = todos.filter((d) => !inviavel(d));
  const foraDaEscala = todos.filter(inviavel);
  const m3 = mediaReceita(3);
  const m6 = mediaReceita(6);
  const maxV = Math.max(1, ...degraus.map((d) => n0(d.valor_rs)), m3 ? m3.valor : 0, m6 ? m6.valor : 0);
  const ref = m3 ? m3.valor : null;
  const pos = (v: number) => Math.min(100, Math.max(0, (v / maxV) * 100)).toFixed(2);
  const marcas = `${m3 ? `<span class="sf-marca sf-marca-3" style="left:${pos(m3.valor)}%" title="Média 3 meses: ${esc(fmtR(m3.valor))}"></span>` : ""}${m6 ? `<span class="sf-marca sf-marca-6" style="left:${pos(m6.valor)}%" title="Média 6 meses: ${esc(fmtR(m6.valor))}"></span>` : ""}`;
  const falta = (v: number) => {
    const alcancado = ref != null && ref >= v;
    return ref != null && !alcancado ? `<span class="sf-neg" style="font-weight:600"> · falta ${esc(fmtR(v - ref))}/mês</span>` : (alcancado ? `<span class="sf-pos" style="font-weight:600"> · já alcançado</span>` : "");
  };
  const escada = degraus.map((d) => {
    const v = n0(d.valor_rs);
    const alcancado = ref != null && ref >= v;
    const cor = alcancado ? "#16A34A" : "#C41E3A";
    return `<div class="sf-degrau">
      <div class="sf-degrau-top"><span>${esc(d.patamar || "")}${d.quando ? `<div class="sf-degrau-quando">${esc(d.quando)}</div>` : ""}</span><strong>${esc(fmtR(v))}${falta(v)}</strong></div>
      <div class="sf-trilho"><div class="sf-trilho-bar" style="width:${pos(v)}%;background:${cor};opacity:${alcancado ? 1 : 0.78}"></div>${marcas}</div>
      ${d.conta ? `<div class="sf-degrau-conta">Conta: ${esc(d.conta)}</div>` : ""}
    </div>`;
  }).join("");
  const semEscala = foraDaEscala.map((d) => `<div class="sf-degrau sf-degrau-inviavel">
      <div class="sf-degrau-top"><span>${esc(d.patamar || "")}${d.quando ? `<div class="sf-degrau-quando">${esc(d.quando)}</div>` : ""}</span><strong>${esc(fmtR(d.valor_rs))}</strong></div>
      ${d.conta ? `<div class="sf-degrau-conta">Conta: ${esc(d.conta)}</div>` : ""}
    </div>`).join("");
  let legenda: string;
  if (m3 || m6) {
    legenda = `<div class="sf-leg">
      ${m3 ? `<span class="sf-leg-i"><span class="sf-dot" style="background:#0F766E"></span>Receita média dos últimos 3 meses fechados (${esc(rotuloMes(m3.de))} a ${esc(rotuloMes(m3.ate))}): <strong>${esc(fmtR(m3.valor))}</strong></span>` : ""}
      ${m6 ? `<span class="sf-leg-i"><span class="sf-dot" style="background:#7C3AED"></span>últimos 6 meses (${esc(rotuloMes(m6.de))} a ${esc(rotuloMes(m6.ate))}): <strong>${esc(fmtR(m6.valor))}</strong></span>` : ""}
    </div>`;
  } else if (aguardandoVivo()) {
    legenda = `<p class="sf-muted" style="margin-top:10px">Buscando a receita dos últimos meses na Vobi…</p>`;
  } else {
    legenda = `<p class="sf-muted" style="margin-top:10px">Sem a leitura da Vobi não dá para comparar com a receita real.</p>`;
  }
  const premissas = arr(m.premissas_a_confirmar);
  return `<div class="card sf-blk">
    <div class="sf-card-t">Quanto a empresa precisa faturar por mês</div>
    ${num(m.valor) != null ? `<div class="sf-meta-v">${esc(fmtR(m.valor))} <span class="sf-small">por mês</span></div>` : ""}
    ${m.texto ? `<p class="sf-small" style="margin-top:4px">${esc(m.texto)}</p>` : ""}
    ${m.nao_inclui ? `<div class="sf-box sf-box-amarelo" style="margin:12px 0 0"><strong>Atenção:</strong>${esc(m.nao_inclui)}</div>` : ""}
    ${escada ? `<div class="sf-escada">${escada}</div>` : ""}
    ${legenda}
    ${semEscala ? `<div class="sf-escada" style="margin-top:16px">${semEscala}</div>` : ""}
    ${m.conta ? `<p class="sf-nota"><strong>A conta:</strong> ${esc(m.conta)}</p>` : ""}
    ${premissas.length ? `<details class="sf-det" style="margin-top:12px"><summary>O que ainda precisa ser confirmado nesta conta (${premissas.length})</summary><div class="sf-det-body" style="white-space:normal">${lista(premissas)}</div></details>` : ""}
  </div>`;
}

function blocoNumeros(): string {
  const nums = arr<{ titulo?: string; valor?: unknown; detalhe?: string; tom?: string }>(D.painel.numeros_chave);
  if (!nums.length) return "";
  const tomDe = (t: unknown) => {
    const k = chaveSituacao(t);
    if (k === "vermelho" || k === "red") return "sf-tom-vermelho";
    if (k === "amarelo" || k === "yellow") return "sf-tom-amarelo";
    if (k === "verde" || k === "green") return "sf-tom-verde";
    return "";
  };
  return `<div class="sf-blk">${blkTitulo("target", "Números que decidem")}
    <div class="sf-nums">${nums.map((n) => `<div class="sf-numc ${tomDe(n.tom)}">
      <div class="sf-numc-t">${esc(n.titulo || "")}</div>
      <div class="sf-numc-v">${esc(valorLivre(n.valor))}</div>
      ${n.detalhe ? `<div class="sf-numc-d">${esc(n.detalhe)}</div>` : ""}
    </div>`).join("")}</div></div>`;
}

function blocoCreditos(): string {
  const cs = arr<Credito>(D.painel.creditos);
  if (!cs.length) return "";
  // sem a marcação do seed: crédito de imposto/compensação = não vira caixa; o resto entra como "dinheiro a receber"
  const tipo = (c: Credito): "caixa" | "imposto" | "talvez" => {
    if (c.vira_caixa === true) return "caixa";
    if (c.vira_caixa === false) return "imposto";
    if (typeof c.vira_caixa === "string") return "talvez";
    return /reten|compensa|dcomp/i.test(`${txt(c.titulo)} ${txt(c.observacao)}`) ? "imposto" : "caixa";
  };
  const tabela = (l: Credito[], total: boolean) => `<div class="card" style="padding:0"><div class="table-wrap"><table class="sf-table">
      <thead><tr><th>O quê</th><th class="sf-num">Valor</th><th>Data</th><th>Observação</th></tr></thead>
      <tbody>${l.map((c) => `<tr><td><strong>${esc(c.titulo || "")}</strong>${tipo(c) === "talvez" ? `<div><span class="badge badge-yellow">Depende de decisão</span></div>` : ""}</td><td class="sf-num">${esc(valorLivre(c.valor))}</td><td>${esc(fmtData(c.data))}</td><td class="sf-obs">${esc(c.observacao || "")}</td></tr>`).join("")}</tbody>
      ${total ? `<tfoot><tr><td>Total</td><td class="sf-num">${esc(fmtR(l.reduce((s, c) => s + n0(c.valor), 0)))}</td><td colspan="2"></td></tr></tfoot>` : ""}
    </table></div></div>`;
  const certos = cs.filter((c) => tipo(c) === "caixa");
  const talvez = cs.filter((c) => tipo(c) === "talvez");
  const imposto = cs.filter((c) => tipo(c) === "imposto");
  return `<div class="sf-blk">${blkTitulo("cash", "Dinheiro a receber")}
    ${certos.length ? tabela(certos, true) : `<p class="sf-muted">Nada previsto.</p>`}
    ${talvez.length ? `<p class="sf-card-t" style="margin-top:14px">Pode virar dinheiro, depende de decisão (fora da soma)</p>${tabela(talvez, false)}` : ""}
    ${imposto.length ? `<div style="margin-top:18px">${blkTitulo("receipt-refund", "Créditos de imposto (não entram no caixa)")}
      ${tabela(imposto, false)}
      <p class="sf-nota">Estes créditos abatem dívida com a Receita ou com a PGFN; não viram dinheiro na conta. Não some com o “Dinheiro a receber”.</p></div>` : ""}
  </div>`;
}

/** Grupos que ficam FORA da soma das contas da empresa (a Vobi guarda esses valores de um jeito que não é dívida a pagar agora). */
const FORA_DA_CONTA: Record<string, string> = {
  banco: "A Vobi guarda os empréstimos com as parcelas futuras e com “balões” de vencimento fictício (01/12/2030). Não é o saldo devedor: veja a aba Bancos.",
  socios: "Pró-labore e empréstimos dos sócios. Não pagar agora: os sócios são os últimos da fila.",
  pessoa_fisica: "Financiamento do imóvel MMM, taxa do corretor e empréstimos da pessoa física pagos pela empresa. É dívida da pessoa física, não da empresa.",
  fornecedor_contingente: "Honorário da Tax All: só é devido se o crédito de retenção for compensado.",
  outros: "Lançamentos que não se encaixam nos grupos acima (ex.: credor = a própria empresa). Conferir conta por conta.",
};
function foraDaConta(grupo: string): boolean { return Object.prototype.hasOwnProperty.call(FORA_DA_CONTA, grupo); }

function blocoAbertoVivo(): string {
  const aviso = avisoVivo();
  if (aviso) return `<div class="sf-blk">${blkTitulo("list-check", "Contas a pagar em aberto na Vobi")}${aviso}</div>`;
  const ab = vivo?.aberto;
  if (!ab) return "";
  const dentro = ab.porGrupo.filter((g) => !foraDaConta(g.grupo));
  const fora = ab.porGrupo.filter((g) => foraDaConta(g.grupo));
  const tot = dentro.reduce((s, g) => ({ t: s.t + n0(g.total), v: s.v + n0(g.vencido), a: s.a + n0(g.aVencer), q: s.q + n0(g.qtd) }), { t: 0, v: 0, a: 0, q: 0 });
  const p90 = new Map<string, number>();
  for (const p of arr<{ mes: string; grupo: string; total: number }>(ab.proximos90)) {
    if (foraDaConta(p.grupo)) continue;
    p90.set(p.mes, (p90.get(p.mes) || 0) + n0(p.total));
  }
  const prox = [...p90.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const rot = (g: { grupo: string; rotulo?: string }) => esc(g.rotulo || D.rotuloGrupoAberto[g.grupo] || g.grupo);
  const totFora = fora.reduce((s, g) => s + n0(g.total), 0);
  const tabelaFora = fora.length ? `<details class="sf-det" style="margin-top:12px"><summary>Fora desta conta: bancos, sócios, pessoa física e outros (${esc(fmtR(totFora))})</summary>
      <div class="table-wrap" style="padding:0 6px 10px"><table class="sf-table">
      <thead><tr><th>Grupo</th><th class="sf-num">Total na Vobi</th><th>Por que fica fora</th></tr></thead>
      <tbody>${fora.map((g) => `<tr><td><strong>${rot(g)}</strong><div class="sf-muted">${esc(fmtN(g.qtd))} conta(s)</div></td><td class="sf-num">${esc(fmtR(g.total))}</td><td class="sf-obs">${esc(FORA_DA_CONTA[g.grupo])}</td></tr>`).join("")}</tbody>
      </table></div></details>` : "";
  return `<div class="sf-blk">${blkTitulo("list-check", "Contas a pagar em aberto na Vobi", `<span class="sf-tag-vivo">ao vivo</span>`)}
    <div class="sf-kpis">
      <div class="sf-kpi"><div class="sf-kpi-v">${esc(fmtR(tot.t))}</div><div class="sf-kpi-l">Total em aberto, sem bancos, sócios e pessoa física (${esc(fmtN(tot.q))} contas)</div></div>
      <div class="sf-kpi"><div class="sf-kpi-v sf-neg">${esc(fmtR(tot.v))}</div><div class="sf-kpi-l">Já vencido</div></div>
      <div class="sf-kpi"><div class="sf-kpi-v">${esc(fmtR(tot.a))}</div><div class="sf-kpi-l">A vencer</div></div>
      ${prox.map(([mes, v]) => `<div class="sf-kpi"><div class="sf-kpi-v">${esc(fmtR(v))}</div><div class="sf-kpi-l">Vence em ${esc(rotuloMes(mes))}</div></div>`).join("")}
    </div>
    <div class="card" style="padding:0"><div class="table-wrap"><table class="sf-table">
      <thead><tr><th>Grupo</th><th class="sf-num">Vencido</th><th class="sf-num">A vencer</th><th class="sf-num">Total</th><th class="sf-num">Contas</th></tr></thead>
      <tbody>${dentro.map((g) => `<tr><td>${rot(g)}</td><td class="sf-num sf-neg">${esc(fmtR(g.vencido))}</td><td class="sf-num">${esc(fmtR(g.aVencer))}</td><td class="sf-num"><strong>${esc(fmtR(g.total))}</strong></td><td class="sf-num">${esc(fmtN(g.qtd))}</td></tr>`).join("")}</tbody>
      <tfoot><tr><td>Total</td><td class="sf-num">${esc(fmtR(tot.v))}</td><td class="sf-num">${esc(fmtR(tot.a))}</td><td class="sf-num">${esc(fmtR(tot.t))}</td><td class="sf-num">${esc(fmtN(tot.q))}</td></tr></tfoot>
    </table></div></div>
    ${tabelaFora}
    <p class="sf-nota">“Vence em” mostra só os próximos 90 dias. Impostos da União (PGFN e Receita) e os protestos não estão na Vobi: ficam nas abas Impostos e Protestos. Os impostos desta tabela são só os que estão lançados na Vobi.</p></div>`;
}

function blocoOutros(): string {
  const l = dividasDo("outro");
  if (!l.length) return "";
  const naEmpresa = (d: SfDivida) => /^(FGTS|Trabalhista|Pessoal)$/i.test(txt(d.subgrupo).trim());
  const dentro = l.filter(naEmpresa);
  const fora = l.filter((d) => !naEmpresa(d));
  const subtotais = new Map<string, number>();
  for (const d of fora) { const k = txt(d.subgrupo).trim() || "Sem grupo"; subtotais.set(k, (subtotais.get(k) || 0) + n0(d.valor)); }
  return `<details class="sf-det sf-blk" id="sfOutros"><summary>Dívidas do grupo “Outros”: trabalhista, FGTS, sócios e pessoa física (${l.length})</summary>
    <div style="padding:0 6px 10px">
      <p class="sf-card-t" style="margin-top:6px">Dívida da empresa (entra no total): ${esc(fmtR(somaValor(dentro)))}</p>
      ${tabelaSimples(dentro)}
      ${fora.length ? `<p class="sf-card-t" style="margin-top:16px">Fora da soma da dívida: sócios, pessoa física e a conferir (${esc(fmtR(somaValor(fora)))})</p>
        <p class="sf-small" style="margin-bottom:8px">${[...subtotais.entries()].map(([k, v]) => `${esc(k)}: <strong>${esc(fmtR(v))}</strong>`).join(" · ")}</p>
        ${tabelaSimples(fora)}` : ""}
    </div></details>`;
}

function blocoAlertas(): string {
  const al = arr<{ titulo?: string; texto?: string }>(D.painel.alertas);
  const lac = arr(D.painel.lacunas);
  if (!al.length && !lac.length) return "";
  return `<div class="sf-blk">${blkTitulo("alert-triangle", "Alertas")}
    ${al.map((a) => `<details class="sf-det sf-det-alerta"><summary>${esc(a.titulo || "Alerta")}</summary><div class="sf-det-body">${esc(a.texto || "")}</div></details>`).join("")}
    ${lac.length ? `<details class="sf-det"><summary>O que ainda falta levantar (${lac.length})</summary><div class="sf-det-body" style="white-space:normal">${lista(lac)}</div></details>` : ""}
  </div>`;
}

// ───────────────────────── 2. Impostos ─────────────────────────
/** Soma de um bloco: "valor não levantado" quando nenhuma linha tem valor (em vez de um R$ 0,00 enganoso). */
function celSoma(ds: SfDivida[]): string {
  const comValor = ds.some((d) => num(d.valor) != null);
  const comTeto = ds.some((d) => num(d.valor_teto) != null);
  if (!comValor && !comTeto) return `<span class="sf-muted">valor não levantado</span>`;
  const sv = somaValor(ds), st = somaTeto(ds);
  return `${esc(fmtR(sv))}${st !== sv ? `<div class="sf-muted">até ${esc(fmtR(st))}</div>` : ""}`;
}
function renderImpostos(): void {
  const sec = el("sfSecImpostos");
  if (!sec) return;
  const l = dividasDo("imposto");
  const gi = D.painel.resumo_dividas?.grupos?.imposto;
  const oficial = num(gi?.valor);
  const quadroOficial = oficial != null ? `<div class="sf-kpis">
      <div class="sf-kpi"><div class="sf-kpi-v">${esc(fmtR(oficial))}</div><div class="sf-kpi-l">Total oficial dos impostos (levantamento${D.painel.resumo_dividas?.data_ref ? " de " + esc(D.painel.resumo_dividas.data_ref) : ""})</div></div>
    </div>${gi?.nota ? `<p class="sf-nota" style="margin:-4px 0 12px">${esc(gi.nota)}</p>` : ""}` : "";
  let tabela: string;
  if (!l.length) {
    tabela = `<div class="empty-state"><strong>Nenhum imposto cadastrado.</strong>${D.faltaMigration ? "As tabelas ainda não foram criadas." : ""}</div>`;
  } else {
    const grupos = new Map<string, SfDivida[]>();
    for (const d of l) {
      const k = (d.subgrupo || "Outros").trim() || "Outros";
      const lst = grupos.get(k) || [];
      lst.push(d);
      grupos.set(k, lst);
    }
    let corpo = "";
    for (const [sub, ds] of grupos) {
      corpo += `<tr class="sf-sub-head"><td colspan="8">${esc(sub)} <span class="sf-muted">(${ds.length})</span></td></tr>`;
      corpo += ds.map((d) => `<tr>
        <td><strong>${esc(d.credor)}</strong>${d.retido ? `<div><span class="sf-selo-retido" title="Imposto descontado de terceiros e não repassado">Retido – risco penal</span></div>` : ""}</td>
        <td class="sf-small">${esc(d.identificacao || "")}</td>
        <td class="sf-small">${esc(d.natureza || "")}</td>
        <td class="sf-num">${celValor(d)}</td>
        <td>${badgeSituacao(d.situacao)}</td>
        <td style="white-space:nowrap">${d.data_ref ? esc(fmtData(d.data_ref)) : `<span class="sf-muted">—</span>`}</td>
        <td class="sf-obs">${esc(d.observacao || "")}${d.risco ? `<div class="sf-muted" style="margin-top:3px">Risco: ${esc(d.risco)}</div>` : ""}</td>
        <td>${botaoEditar(d.id)}</td></tr>`).join("");
      corpo += `<tr class="sf-sub-tot"><td colspan="3">Subtotal ${esc(sub)}</td><td class="sf-num">${celSoma(ds)}</td><td colspan="4"></td></tr>`;
    }
    const retidos = l.filter((d) => d.retido);
    tabela = `${retidos.length ? `<div class="sf-box sf-box-vermelho"><strong>Atenção — ${retidos.length} item(ns) de imposto retido (${esc(fmtR(somaValor(retidos)))}).</strong> É imposto descontado de terceiros e não repassado: além da cobrança, pode virar caso penal para os sócios. Prioridade de pagamento.</div>` : ""}
      <div class="card" style="padding:0"><div class="table-wrap"><table class="sf-table">
      <thead><tr><th>Credor / órgão</th><th>Identificação</th><th>Natureza</th><th class="sf-num">Valor</th><th>Situação</th><th>Data</th><th>Observação</th><th></th></tr></thead>
      <tbody>${corpo}</tbody>
      <tfoot><tr><td colspan="3">Soma das linhas (${l.length})${oficial != null ? `<div class="sf-muted" style="font-weight:600">um pouco menor que o total oficial: as linhas misturam datas</div>` : ""}</td><td class="sf-num">${celSoma(l)}</td><td colspan="4"></td></tr></tfoot>
      </table></div></div>`;
  }
  sec.innerHTML = `
    <div class="sf-blk">${blkTitulo("receipt-tax", "Impostos em atraso (levantamento)")}${quadroOficial}${tabela}</div>
    ${quadroFazer("imposto")}
    ${quadroVivo(["imposto_parcelado", "imposto_corrente"], "Na Vobi em aberto — impostos",
      "Não some com a tabela acima: os parcelamentos da Prefeitura são as mesmas contas, e parte do que a Vobi chama de imposto são parcelas de parcelamentos federais já rompidos (cerca de R$ 155 mil), que hoje estão dentro da dívida da PGFN e da Receita.")}`;
}

// ───────────────────────── 3. Bancos ─────────────────────────
function renderBancos(): void {
  const sec = el("sfSecBancos");
  if (!sec) return;
  const l = dividasDo("banco");
  const g = D.painel.resumo_dividas?.grupos?.banco;
  const kpis = g ? `<div class="sf-kpis">
      <div class="sf-kpi"><div class="sf-kpi-v">${esc(fmtR(g.piso))}</div><div class="sf-kpi-l">Mínimo: só os 3 contratos auditados em 2025</div></div>
      <div class="sf-kpi"><div class="sf-kpi-v">${esc(fmtR(g.teto))}</div><div class="sf-kpi-l">Pelo mapa de 08/10, sem 2 contratos da Caixa (pode ser mais)</div></div>
      <div class="sf-kpi"><div class="sf-kpi-v">${esc(fmtR(g.parcela_contratual_mes))}</div><div class="sf-kpi-l">Parcelas do contrato por mês (cronograma de out/2026)</div></div>
      <div class="sf-kpi"><div class="sf-kpi-v">${esc(fmtR(g.pago_medio_mes))}</div><div class="sf-kpi-l">Pago em média por mês</div></div>
    </div>${g.nota ? `<p class="sf-nota" style="margin:-4px 0 12px">${esc(g.nota)}</p>` : ""}` : "";
  let tabela: string;
  if (!l.length) {
    tabela = `<div class="empty-state"><strong>Nenhum contrato de banco cadastrado.</strong></div>`;
  } else {
    const linhas = l.map((d) => {
      const v = num(d.valor), t = num(d.valor_teto);
      const saldo = v == null ? "—" : (t != null && t !== v ? `${esc(fmtR(v))}<div class="sf-muted">até ${esc(fmtR(t))}</div>` : esc(fmtR(v)));
      return `<tr>
        <td><strong>${esc(d.credor)}</strong>${d.subgrupo && d.subgrupo !== d.credor ? `<div class="sf-muted">${esc(d.subgrupo)}</div>` : ""}${d.natureza ? `<div class="sf-muted">${esc(d.natureza)}</div>` : ""}</td>
        <td class="sf-small">${esc(d.identificacao || "")}</td>
        <td class="sf-num">${saldo}</td>
        <td class="sf-num">${num(d.parcela_mensal) ? esc(fmtR(d.parcela_mensal)) : `<span class="sf-muted">—</span>`}</td>
        <td>${badgeSituacao(d.situacao)}</td>
        <td class="sf-obs">${esc(d.risco || "")}</td>
        <td class="sf-obs">${esc(d.observacao || "")}</td>
        <td>${botaoEditar(d.id)}</td></tr>`;
    }).join("");
    const sv = somaValor(l), st = somaTeto(l), sp = somaParcela(l);
    tabela = `<div class="card" style="padding:0"><div class="table-wrap"><table class="sf-table">
      <thead><tr><th>Banco</th><th>Contrato</th><th class="sf-num">Saldo devido</th><th class="sf-num">Parcela por mês</th><th>Situação</th><th>Risco / aval</th><th>Observação</th><th></th></tr></thead>
      <tbody>${linhas}</tbody>
      <tfoot><tr><td colspan="2">Soma das linhas (${l.length} contratos)<div class="sf-muted" style="font-weight:600">não é o total: mistura datas e pode contar o Bradesco duas vezes</div></td>
        <td class="sf-num">${esc(fmtR(sv))}${st !== sv ? `<div class="sf-muted">até ${esc(fmtR(st))}</div>` : ""}</td>
        <td class="sf-num">${esc(fmtR(sp))}${g && num(g.parcela_contratual_mes) != null && Math.abs(sp - n0(g.parcela_contratual_mes)) > 1 ? `<div class="sf-muted" style="font-weight:600;white-space:normal">inclui cartão da Caixa e Itaú, fora do cronograma de out/2026</div>` : ""}</td><td colspan="4"></td></tr></tfoot>
      </table></div></div>
      <p class="sf-nota">“Saldo devido”: o primeiro número é o menor valor conhecido. O “até” é quanto custaria pagar o contrato até o fim, com os juros futuros — não é o que se deve hoje.</p>`;
  }
  sec.innerHTML = `
    <div class="sf-blk">${blkTitulo("building-bank", "Empréstimos e contratos com bancos")}${kpis}${tabela}</div>
    ${quadroFazer("banco")}
    ${quadroVivo(["banco"], "Na Vobi em aberto — bancos e cartões",
      "Atenção: este total da Vobi inclui as parcelas futuras com juros e “balões” com vencimento fictício em 01/12/2030. Por isso é maior que o saldo devedor e quase tudo aparece como “a vencer”, mesmo atrasado. Use os números do quadro acima.")}`;
}

// ───────────────────────── 4. Fornecedores ─────────────────────────
function listaFornecedores(): PorFornecedor[] {
  const ab = vivo?.aberto;
  if (!ab) return [];
  return ab.porFornecedor.filter((f) => {
    const g = ab.porGrupo.find((x) => x.grupo === f.grupo);
    return g ? g.aba === "fornecedor" : GRUPOS_FORNECEDOR.includes(f.grupo);
  });
}
const GRUPOS_FORNECEDOR: string[] = ["fornecedor_obra", "fornecedor_estrutura", "fornecedor_contingente", "acordo_juridico"];
/** Título do levantamento dos maiores credores (nem todos têm cobrança jurídica). */
function tituloLevantamento(): string {
  const dr = D.painel.resumo_dividas?.data_ref;
  return `Maiores credores (levantamento${dr ? " de " + dr : ""})`;
}
function renderFornecedores(): void {
  const sec = el("sfSecFornecedores");
  if (!sec) return;
  const levant = dividasDo("fornecedor");
  const ab = vivo?.aberto;
  if (!ab) {
    const aviso = avisoVivo() || `<p class="sf-muted">A Vobi não devolveu as contas em aberto nesta leitura.</p>`;
    sec.innerHTML = `
      <div class="sf-blk">${blkTitulo("truck", "Fornecedores")}${aviso}</div>
      <div class="sf-blk">${blkTitulo("gavel", tituloLevantamento())}
        <div class="card" style="padding:0">${tabelaSimples(levant)}</div>
        <p class="sf-nota">A lista completa, fornecedor por fornecedor, aparece aqui quando a leitura da Vobi chegar.</p></div>
      ${quadroFazer("fornecedor")}`;
    return;
  }
  const fl = listaFornecedores();
  const tot = fl.reduce((s, f) => ({ t: s.t + n0(f.total), v: s.v + n0(f.vencido), a: s.a + n0(f.aVencer) }), { t: 0, v: 0, a: 0 });
  const nProt = fl.filter((f) => ehProtestado(f.fornecedor)).length;
  const contingente = fl.filter((f) => f.grupo === "fornecedor_contingente").reduce((s, f) => s + n0(f.total), 0);
  const ordens: Array<[string, string]> = [["total", "Maior total"], ["vencido", "Maior vencido"], ["aVencer", "Maior a vencer"], ["antigo", "Mais antigo primeiro"], ["nome", "Nome (A–Z)"]];
  validarFiltro("fornOrdem", ordens.map(([v]) => v), "total");
  sec.innerHTML = `
    <div class="sf-blk">${blkTitulo("truck", "Fornecedores com contas em aberto", `<span class="sf-tag-vivo">ao vivo · Vobi</span>`)}
      <div class="sf-kpis">
        <div class="sf-kpi"><div class="sf-kpi-v">${esc(fmtR(tot.t))}</div><div class="sf-kpi-l">Total em aberto (${fl.length} fornecedores)</div></div>
        <div class="sf-kpi"><div class="sf-kpi-v sf-neg">${esc(fmtR(tot.v))}</div><div class="sf-kpi-l">Já vencido</div></div>
        <div class="sf-kpi"><div class="sf-kpi-v">${esc(fmtR(tot.a))}</div><div class="sf-kpi-l">A vencer</div></div>
        <div class="sf-kpi"><div class="sf-kpi-v">${nProt}</div><div class="sf-kpi-l">Com título protestado</div></div>
      </div>
      ${contingente > 0 ? `<p class="sf-nota" style="margin:-4px 0 12px">O total inclui ${esc(fmtR(contingente))} de honorário da Tax All, que só é devido se o crédito de retenção for compensado.</p>` : ""}
      <div class="sf-toolbar">
        <input type="search" class="search-input" placeholder="Buscar fornecedor…" data-sf-f="fornBusca" value="${esc(filtros.fornBusca)}" aria-label="Buscar fornecedor" />
        <select class="filter-select" data-sf-f="fornOrdem" aria-label="Ordenar">${ordens.map(([v, r]) => `<option value="${v}"${filtros.fornOrdem === v ? " selected" : ""}>${esc(r)}</option>`).join("")}</select>
      </div>
      <div id="sfFornLista"></div>
    </div>
    ${levant.length ? `<details class="sf-det sf-blk"><summary>${esc(tituloLevantamento())} (${levant.length})</summary><div style="padding:0 6px 10px">${tabelaSimples(levant)}</div></details>` : ""}
    ${quadroFazer("fornecedor")}`;
  renderFornLista();
}
function renderFornLista(): void {
  const alvo = el("sfFornLista");
  if (!alvo) return;
  const q = norm(filtros.fornBusca);
  const l = listaFornecedores().filter((f) => !q || norm(f.fornecedor).includes(q));
  const o = filtros.fornOrdem;
  l.sort((a, b) => {
    if (o === "vencido") return n0(b.vencido) - n0(a.vencido);
    if (o === "aVencer") return n0(b.aVencer) - n0(a.aVencer);
    if (o === "antigo") return String(a.maisAntigo || "9").localeCompare(String(b.maisAntigo || "9"));
    if (o === "nome") return String(a.fornecedor).localeCompare(String(b.fornecedor), "pt-BR");
    return n0(b.total) - n0(a.total);
  });
  if (!l.length) { alvo.innerHTML = `<div class="empty-state"><strong>Nenhum fornecedor encontrado.</strong></div>`; return; }
  const LIM = 400;
  const hoje = hojeISO();
  const vis = l.slice(0, LIM);
  alvo.innerHTML = `<div class="card" style="padding:0"><div class="table-wrap"><table class="sf-table">
    <thead><tr><th>Fornecedor</th><th class="sf-num">Total</th><th class="sf-num">Vencido</th><th class="sf-num">A vencer</th><th class="sf-num">Contas</th><th>Vencimento mais antigo</th></tr></thead>
    <tbody>${vis.map((f) => `<tr>
      <td><strong>${esc(f.fornecedor)}</strong>${ehProtestado(f.fornecedor) ? `<span class="sf-selo-prot" title="Há título deste credor na lista de protestos">Protestado</span>` : ""}<div class="sf-muted">${esc(D.rotuloGrupoAberto[f.grupo] || f.grupo)}</div></td>
      <td class="sf-num"><strong>${esc(fmtR(f.total))}</strong></td>
      <td class="sf-num${n0(f.vencido) > 0 ? " sf-neg" : ""}">${esc(fmtR(f.vencido))}</td>
      <td class="sf-num">${esc(fmtR(f.aVencer))}</td>
      <td class="sf-num">${esc(fmtN(f.qtd))}</td>
      <td style="white-space:nowrap"${f.maisAntigo && f.maisAntigo < hoje ? ` class="sf-neg"` : ""}>${esc(fmtData(f.maisAntigo))}</td></tr>`).join("")}</tbody>
    </table></div></div>
    <p class="sf-nota">${l.length > LIM ? `Mostrando os ${LIM} primeiros de ${l.length}. Use a busca para achar os demais. ` : `${l.length} fornecedor(es). `}O selo “Protestado” aparece quando o nome bate com um credor da aba Protestos — confira antes de usar.</p>`;
}

// ───────────────────────── 5. Despesas fixas ─────────────────────────
const SERIES: Array<{ k: keyof FluxoMes; nome: string; cor: string }> = [
  { k: "fixa", nome: "Despesa fixa", cor: "#2563EB" },
  { k: "variavel", nome: "Custo da obra", cor: "#F59E0B" },
  { k: "tributo", nome: "Impostos sobre a venda", cor: "#7C3AED" },
  { k: "divida", nome: "Pagamento de dívidas", cor: "#DC2626" },
];
function renderFixas(): void {
  const sec = el("sfSecFixas");
  if (!sec) return;
  const df = D.painel.despesas_fixas;
  const itens = arr<{ nome?: string; categoria?: string; valor?: Num }>(df?.itens);
  const somaItens = itens.reduce((s, i) => s + n0(i.valor), 0);
  const tabela = itens.length ? `<div class="card" style="padding:0"><div class="table-wrap"><table class="sf-table">
      <thead><tr><th>Despesa</th><th>Categoria</th><th class="sf-num">Valor por mês</th></tr></thead>
      <tbody>${itens.map((i) => `<tr><td>${esc(i.nome || "")}</td><td class="sf-small">${esc(i.categoria || "")}</td><td class="sf-num">${esc(fmtR(i.valor))}</td></tr>`).join("")}</tbody>
      <tfoot><tr><td colspan="2">Total (${itens.length} itens)</td><td class="sf-num">${esc(fmtR(somaItens))}</td></tr></tfoot>
    </table></div></div>` : `<div class="empty-state"><strong>Lista de despesas fixas ainda não cadastrada.</strong></div>`;
  const kpis = df ? `<div class="sf-kpis">
      ${num(df.total_mensal) != null ? `<div class="sf-kpi"><div class="sf-kpi-v">${esc(fmtR(df.total_mensal))}</div><div class="sf-kpi-l">Custo fixo por mês${df.data_ref ? ` (${esc(df.data_ref)})` : ""}</div></div>` : ""}
      ${num(df.realizado_medio_jul_set) != null ? `<div class="sf-kpi"><div class="sf-kpi-v">${esc(fmtR(df.realizado_medio_jul_set))}</div><div class="sf-kpi-l">Gasto de fato, média jul–set</div></div>` : ""}
    </div>` : "";

  // gráfico dos últimos 12 meses fechados
  const f12 = fluxoFechado().slice(-12);
  let grafico: string;
  if (!f12.length) {
    grafico = avisoVivo() || `<p class="sf-muted">Sem meses fechados na leitura da Vobi.</p>`;
  } else {
    const max = Math.max(1, ...f12.map((m) => Math.max(n0(m.receita), SERIES.reduce((s, x) => s + n0(m[x.k]), 0))));
    const H = 170;
    const px = (v: number) => (v > 0 ? Math.max(2, Math.round((v / max) * H)) : 0);
    const cols = f12.map((m) => {
      const desp = SERIES.reduce((s, x) => s + n0(m[x.k]), 0);
      const dica = `${rotuloMes(m.mes)} · receita ${fmtR(m.receita)} · despesas ${fmtR(desp)} (fixa ${fmtR(m.fixa)}, obra ${fmtR(m.variavel)}, impostos ${fmtR(m.tributo)}, dívidas ${fmtR(m.divida)})`;
      return `<div class="sf-col" title="${esc(dica)}">
        <div class="sf-pair">
          <div class="sf-bar" style="height:${px(n0(m.receita))}px;background:#16A34A"></div>
          <div class="sf-stackv" style="height:${px(desp)}px">${SERIES.map((x) => {
            const v = n0(m[x.k]);
            return v > 0 && desp > 0 ? `<div style="height:${((v / desp) * 100).toFixed(2)}%;background:${x.cor}"></div>` : "";
          }).join("")}</div>
        </div>
        <div class="sf-col-l">${esc(rotuloMes(m.mes))}</div></div>`;
    }).join("");
    const media = (lst: FluxoMes[], k: keyof FluxoMes) => (lst.length ? lst.reduce((s, m) => s + n0(m[k]), 0) / lst.length : 0);
    const f3 = f12.slice(-3);
    const linhasMedia = [{ k: "receita" as keyof FluxoMes, nome: "Receita das obras e serviços", cor: "#16A34A" }, ...SERIES].map((x) =>
      `<tr><td><span class="sf-dot" style="background:${x.cor};margin-right:6px"></span>${esc(x.nome)}</td><td class="sf-num">${esc(fmtR(media(f12, x.k)))}</td><td class="sf-num">${esc(fmtR(media(f3, x.k)))}</td></tr>`).join("");
    const sobra12 = media(f12, "receita") - SERIES.reduce((s, x) => s + media(f12, x.k), 0);
    const sobra3 = media(f3, "receita") - SERIES.reduce((s, x) => s + media(f3, x.k), 0);
    grafico = `<div class="sf-chart-wrap"><div class="sf-chart">${cols}</div></div>
      <div class="sf-leg"><span class="sf-leg-i"><span class="sf-dot" style="background:#16A34A"></span>Receita</span>${SERIES.map((x) => `<span class="sf-leg-i"><span class="sf-dot" style="background:${x.cor}"></span>${esc(x.nome)}</span>`).join("")}</div>
      <div class="table-wrap" style="margin-top:14px"><table class="sf-table">
        <thead><tr><th>Média por mês</th><th class="sf-num">12 meses (${esc(rotuloMes(f12[0].mes))} a ${esc(rotuloMes(f12[f12.length - 1].mes))})</th><th class="sf-num">Últimos 3 meses</th></tr></thead>
        <tbody>${linhasMedia}</tbody>
        <tfoot><tr><td>Sobra (receita − despesas acima)</td><td class="sf-num ${sobra12 < 0 ? "sf-neg" : "sf-pos"}">${esc(fmtR(sobra12))}</td><td class="sf-num ${sobra3 < 0 ? "sf-neg" : "sf-pos"}">${esc(fmtR(sobra3))}</td></tr></tfoot>
      </table></div>
      <p class="sf-nota">Valores realizados (o que de fato entrou e saiu), lidos da Vobi. Cada mês tem duas barras: a verde é a receita; a outra soma as despesas por tipo. Passe o mouse para ver os números. Repasses para pessoa física e gastos que não se repetem ficam fora.</p>`;
  }

  sec.innerHTML = `
    <div class="sf-blk">${blkTitulo("home-dollar", "Custo fixo mensal")}${kpis}${tabela}${df?.observacao ? `<p class="sf-nota">${esc(df.observacao)}</p>` : ""}</div>
    <div class="card sf-blk"><div class="sf-card-t">Receita × despesas nos últimos 12 meses fechados ${vivo ? `<span class="sf-tag-vivo">ao vivo</span>` : ""}</div>${grafico}</div>
    ${blocoEquilibrio()}`;
}
function blocoEquilibrio(): string {
  const m = D.painel.meta;
  const margem = num(m?.margem), trib = num(m?.tributo), fixo = num(m?.fixo_mensal), div = num(m?.divida_mensal);
  let conta = "";
  if (margem != null && trib != null && fixo != null) {
    const sobra = margem - trib;
    const custo = fixo + (div ?? 0);
    let fat = sobra > 0 ? Math.round(custo / sobra) : null;
    // diferença só de arredondamento dos percentuais → usa o número oficial da meta (o mesmo da visão geral)
    const oficial = num(m?.valor);
    if (fat != null && oficial != null && oficial > 0 && Math.abs(fat - oficial) / oficial < 0.005) fat = oficial;
    conta = `<p class="sf-small" style="line-height:1.6">De cada <strong>R$ 100,00</strong> faturados, sobram <strong>${esc(fmtR(margem * 100))}</strong> depois do custo direto da obra e, desses, <strong>${esc(fmtR(trib * 100))}</strong> vão para o imposto. Restam <strong>${esc(fmtR(sobra * 100))}</strong> para pagar o custo fixo (${esc(fmtR(fixo))})${div ? ` e as dívidas que já estão sendo pagas (${esc(fmtR(div))})` : ""}.</p>
      <p class="sf-small" style="margin-top:8px">Conta: ${esc(fmtR(custo))} ÷ ${esc(sobra.toLocaleString("pt-BR", { maximumFractionDigits: 4 }))} = <strong style="font-size:1.05rem;color:var(--brand)">${fat == null ? "não fecha (a margem não cobre o imposto)" : esc(fmtR(fat)) + " por mês"}</strong></p>`;
  } else if (m?.conta) {
    conta = `<p class="sf-small">${esc(m.conta)}</p>`;
  }
  return `<div class="card sf-blk"><div class="sf-card-t">Ponto de equilíbrio: o que é</div>
    <p class="sf-small" style="margin-bottom:8px">É quanto a empresa precisa faturar por mês para pagar a estrutura e as dívidas já combinadas sem fazer dívida nova. Abaixo disso, cada mês aumenta o buraco.</p>
    ${conta || `<p class="sf-muted">Faltam os números da meta para fazer a conta.</p>`}</div>`;
}

// ───────────────────────── 6. Plano de ação ─────────────────────────
function acaoPorId(id: string): SfAcao | undefined { return D.acoes.find((a) => a.id === id); }
function statusAtual(a: SfAcao): string { return rascAcao[a.id]?.status ?? a.status ?? "ideia"; }
function valoresDistintos(campo: "dificuldade" | "investimento"): string[] {
  return [...new Set(D.acoes.map((a) => txt(a[campo]).trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
}
function rotuloDificuldade(v: string): string { return DIFICULDADE[chaveSituacao(v)] || primeiraMaiuscula(v); }

function renderPlano(): void {
  const sec = el("sfSecPlano");
  if (!sec) return;
  if (!D.acoes.length) {
    sec.innerHTML = `<div class="empty-state"><strong>Nenhuma ideia cadastrada ainda.</strong>${D.faltaMigration ? "As tabelas ainda não foram criadas." : ""}</div>${blocoPlanoVendas()}`;
    return;
  }
  const rp = D.painel.resumo_plano;
  const nDesc = D.acoes.filter((a) => a.descartada).length;
  const ativasN = num(rp?.ideias_ativas) ?? (D.acoes.length - nDesc);
  const descN = num(rp?.descartadas) ?? nDesc;
  const resumo = rp ? `<p class="sf-small" style="margin-bottom:10px"><strong>${esc(fmtN(ativasN))} ideias ativas</strong>${descN ? ` (${esc(fmtN(descN))} descartadas pela revisão)` : ""}${rp.por_onda ? ` · onda 1: ${esc(fmtN(rp.por_onda.onda_1))} · onda 2: ${esc(fmtN(rp.por_onda.onda_2))} · onda 3: ${esc(fmtN(rp.por_onda.onda_3))}` : ""}${rp.data ? ` · plano de ${esc(rp.data)}` : ""}</p>
    ${rp.criterios_ondas ? `<details class="sf-det"><summary>O que é cada onda</summary><div class="sf-det-body" style="white-space:normal"><ul class="sf-lista">${Object.entries(rp.criterios_ondas).map(([k, v]) => `<li><strong>${esc(rotuloChave(k))}:</strong> ${esc(v)}</li>`).join("")}</ul></div></details>` : ""}` : "";
  const top = D.acoes.filter((a) => num(a.top10_ordem) != null).sort((a, b) => n0(a.top10_ordem) - n0(b.top10_ordem));
  const top10 = top.length ? `<div class="sf-blk">${blkTitulo("trophy", "As 10 primeiras a fazer")}
    <ol class="sf-top10">${top.map((a) => `<li><div><a href="#sfa-card-${esc(a.id)}" data-sf-act="ir-ideia" data-id="${esc(a.id)}">${esc(a.titulo)}</a>
      <div class="sf-selos" style="margin:5px 0 0">${seloOnda(a)}<span data-badge-acao="${esc(a.id)}">${badgeStatus(a.status || "ideia")}</span></div>
      ${a.top10_porque ? `<p>${esc(a.top10_porque)}</p>` : ""}</div></li>`).join("")}</ol></div>` : "";
  // filtro guardado com valor que sumiu volta para "todos" (senão a lista fica vazia sem motivo aparente)
  const difs = valoresDistintos("dificuldade");
  const invs = valoresDistintos("investimento");
  validarFiltro("onda", ["1", "2", "3"]);
  validarFiltro("dificuldade", difs);
  validarFiltro("investimento", invs);
  validarFiltro("status", D.statusAcao);
  const opt = (v: string, r: string, sel: string) => `<option value="${esc(v)}"${sel === v ? " selected" : ""}>${esc(r)}</option>`;
  const filtrosHtml = `<div class="sf-toolbar">
      <select class="filter-select" data-sf-f="onda" aria-label="Onda">${opt("", "Todas as ondas", filtros.onda)}${opt("1", "Onda 1 — esta semana", filtros.onda)}${opt("2", "Onda 2 — 30 a 90 dias", filtros.onda)}${opt("3", "Onda 3 — mais de 90 dias", filtros.onda)}</select>
      <select class="filter-select" data-sf-f="dificuldade" aria-label="Dificuldade">${opt("", "Qualquer dificuldade", filtros.dificuldade)}${difs.map((v) => opt(v, rotuloDificuldade(v), filtros.dificuldade)).join("")}</select>
      <select class="filter-select" data-sf-f="investimento" aria-label="Investimento">${opt("", "Qualquer investimento", filtros.investimento)}${invs.map((v) => opt(v, "Investimento: " + v, filtros.investimento)).join("")}</select>
      <select class="filter-select" data-sf-f="status" aria-label="Situação">${opt("", "Qualquer situação", filtros.status)}${D.statusAcao.map((s) => opt(s, D.rotuloStatus[s] || s, filtros.status)).join("")}</select>
      <input type="search" class="search-input" placeholder="Buscar ideia…" data-sf-f="busca" value="${esc(filtros.busca)}" aria-label="Buscar ideia" />
      <label class="sf-chk"><input type="checkbox" data-sf-f="descartadas"${filtros.descartadas ? " checked" : ""} /> mostrar descartadas</label>
    </div>`;
  sec.innerHTML = `
    ${top10}
    <div class="sf-blk">${blkTitulo("bulb", "Todas as ideias")}${resumo}
      <div class="sf-cont" id="sfPlanoCont"></div>
      ${filtrosHtml}
      <p class="sf-muted" id="sfPlanoInfo" style="margin-bottom:8px"></p>
      <div class="sf-ideias" id="sfIdeias"></div>
      <div id="sfDescartadas" style="margin-top:14px"></div>
    </div>
    ${blocoPlanoVendas()}`;
  renderPlanoContadores();
  renderPlanoLista();
}
function renderPlanoContadores(): void {
  const alvo = el("sfPlanoCont");
  if (!alvo) return;
  const cont: Record<string, number> = {};
  for (const a of D.acoes) {
    const s = a.descartada ? "descartado" : (a.status || "ideia"); // as descartadas pela revisão contam em "Descartado"
    cont[s] = (cont[s] || 0) + 1;
  }
  alvo.innerHTML = D.statusAcao.map((s) =>
    `<button type="button" class="pill${filtros.status === s ? " active" : ""}" data-sf-act="filtro-status" data-v="${esc(s)}">${esc(D.rotuloStatus[s] || s)} <span class="count">${cont[s] || 0}</span></button>`).join("");
}
/** Mostrar as descartadas: pela caixa "mostrar descartadas" ou ao filtrar pela situação "Descartado". */
function mostrandoDescartadas(): boolean { return filtros.descartadas || filtros.status === "descartado"; }
function filtraAcao(a: SfAcao): boolean {
  if (a.descartada && !mostrandoDescartadas()) return false;
  if (filtros.onda && String(a.onda ?? "") !== filtros.onda) return false;
  if (filtros.dificuldade && txt(a.dificuldade).trim() !== filtros.dificuldade) return false;
  if (filtros.investimento && txt(a.investimento).trim() !== filtros.investimento) return false;
  if (filtros.status) {
    const st = a.descartada ? "descartado" : (a.status || "ideia");
    if (st !== filtros.status) return false;
  }
  if (filtros.busca) {
    const q = norm(filtros.busca);
    const alvo = norm([a.titulo, a.descricao, a.potencial_mensal, a.responsavel, a.notas, a.codigo].map(txt).join(" "));
    if (!alvo.includes(q)) return false;
  }
  return true;
}
function renderPlanoLista(): void {
  const alvo = el("sfIdeias");
  if (!alvo) return;
  const l = D.acoes.filter(filtraAcao).sort((a, b) =>
    (n0(a.onda) - n0(b.onda)) || (n0(a.ordem) - n0(b.ordem)) || (n0(a.codigo) - n0(b.codigo)));
  const ativas = D.acoes.filter((a) => !a.descartada).length;
  const info = el("sfPlanoInfo");
  if (info) info.textContent = `Mostrando ${l.length} de ${mostrandoDescartadas() ? D.acoes.length : ativas} ideias.`;
  alvo.innerHTML = l.length ? l.map(cardIdeia).join("") : `<div class="empty-state" style="grid-column:1/-1"><strong>Nenhuma ideia com esses filtros.</strong></div>`;
  const desc = el("sfDescartadas");
  if (desc) {
    const dl = D.acoes.filter((a) => a.descartada);
    desc.innerHTML = !mostrandoDescartadas() && dl.length ? `<details class="sf-det"><summary>Ideias descartadas pela revisão (${dl.length})</summary>
      <div class="sf-det-body" style="white-space:normal"><ul class="sf-lista">${dl.map((a) => `<li><strong>${a.codigo != null ? "#" + esc(a.codigo) + " " : ""}${esc(a.titulo)}</strong>${a.motivo_descarte ? ` — ${esc(a.motivo_descarte)}` : ""}</li>`).join("")}</ul></div></details>` : "";
  }
}
/** Selo da onda; quando a revisão subiu só parte da ideia para a onda 1, o selo diz isso. */
function seloOnda(a: SfAcao): string {
  const onda = n0(a.onda);
  if (!onda) return "";
  const m = /Sobe para a onda\s*\d\s*\(([^)]+)\)/i.exec(txt(a.ajuste_revisor));
  const extra = m ? ` (${m[1].trim()})` : "";
  return `<span class="badge badge-${ONDA_COR[onda] || "gray"}"${m ? ` title="Só uma parte da ideia foi para a onda ${onda}: veja o ajuste da revisão."` : ""}>Onda ${onda}${esc(extra)}</span>`;
}
function roteiroHtml(r: unknown): string {
  let v: unknown = r;
  if (typeof r === "string") {
    const s = r.trim();
    if (s.startsWith("{")) { try { v = JSON.parse(s); } catch { v = r; } }
  }
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return `<dl>${Object.entries(v as Record<string, unknown>).map(([k, x]) => `<dt>${esc(rotuloChave(k))}</dt><dd class="sf-texto">${esc(x)}</dd>`).join("")}</dl>`;
  }
  return `<div class="sf-texto">${esc(v)}</div>`;
}
function cardIdeia(a: SfAcao): string {
  const id = a.id;
  const r = rascAcao[id] || {};
  const st = statusAtual(a);
  const resp = r.responsavel ?? a.responsavel ?? "";
  const prazo = r.prazo ?? (a.prazo ? String(a.prazo).slice(0, 10) : "");
  const notas = r.notas ?? a.notas ?? "";
  const dis = D.podeEditar ? "" : " disabled";
  const selos = [
    seloOnda(a),
    num(a.top10_ordem) != null ? `<span class="badge badge-red">Top ${esc(fmtN(a.top10_ordem))}</span>` : "",
    a.dificuldade ? `<span class="badge badge-gray">${esc(rotuloDificuldade(txt(a.dificuldade)))}</span>` : "",
    a.investimento ? `<span class="badge badge-gray">Investimento: ${esc(a.investimento)}</span>` : "",
    a.prazo_primeiro_faturamento ? `<span class="badge badge-orange" title="Prazo até o primeiro faturamento">1º dinheiro: ${esc(a.prazo_primeiro_faturamento)}</span>` : "",
    a.grupo ? `<span class="badge badge-gray">${esc(GRUPO_IDEIA[a.grupo] || rotuloChave(a.grupo))}</span>` : "",
    `<span data-badge-acao="${esc(id)}">${badgeStatus(a.status || "ideia")}</span>`,
  ].join("");
  const passos = arr(a.primeiros_passos);
  const fontes = arr(a.fontes);
  const m = msgAcao[id];
  const mais = [
    a.como_o_mercado_fatura ? `<div class="sf-campo"><b>Como o mercado fatura</b><div class="sf-texto">${esc(a.como_o_mercado_fatura)}</div></div>` : "",
    a.margem_tipica ? `<div class="sf-campo"><b>Margem típica</b>${esc(a.margem_tipica)}</div>` : "",
    a.precisa_de ? `<div class="sf-campo"><b>Precisa de</b><div class="sf-texto">${esc(a.precisa_de)}</div></div>` : "",
    a.roteiro_venda ? `<div class="sf-campo"><b>Roteiro de venda</b>${roteiroHtml(a.roteiro_venda)}</div>` : "",
    a.impeditivos ? `<div class="sf-campo"><b>Impeditivos</b><div class="sf-texto">${esc(a.impeditivos)}</div></div>` : "",
    fontes.length ? `<div class="sf-fontes"><b class="sf-small">Fontes:</b> ${fontes.map(linkSeguro).join(" · ")}</div>` : "",
  ].join("");
  return `<article class="sf-ideia${a.descartada ? " sf-ideia-descartada" : ""}" id="sfa-card-${esc(id)}">
    ${a.descartada ? `<div class="sf-descarte"><strong>Descartada pela revisão.</strong> ${esc(a.motivo_descarte || "")}</div>` : ""}
    <div class="sf-ideia-h">${a.codigo != null ? `<span class="sf-ideia-cod">#${esc(a.codigo)}</span>` : ""}${esc(a.titulo)}</div>
    <div class="sf-selos">${selos}</div>
    ${a.potencial_mensal ? `<div class="sf-pot"><strong>Potencial por mês:</strong> ${esc(a.potencial_mensal)}</div>` : ""}
    ${a.descricao ? `<div class="sf-campo sf-texto">${esc(a.descricao)}</div>` : ""}
    ${passos.length ? `<div class="sf-campo"><b>Primeiros passos</b>${lista(passos, true, "")}</div>` : ""}
    ${a.ajuste_revisor ? `<div class="sf-revisor"><strong>Ajuste da revisão:</strong> ${esc(a.ajuste_revisor)}</div>` : ""}
    ${mais ? `<details class="sf-det" style="margin-top:10px"><summary>Mercado, roteiro de venda, impeditivos e fontes</summary><div style="padding:0 14px 12px">${mais}</div></details>` : ""}
    <div class="sf-form">
      <div><label for="sfa-st-${esc(id)}">Situação</label><select id="sfa-st-${esc(id)}" data-acao-campo="status" data-id="${esc(id)}"${dis}>${D.statusAcao.map((s) => `<option value="${esc(s)}"${s === st ? " selected" : ""}>${esc(D.rotuloStatus[s] || s)}</option>`).join("")}</select></div>
      <div><label for="sfa-re-${esc(id)}">Responsável</label><input id="sfa-re-${esc(id)}" type="text" maxlength="80" data-acao-campo="responsavel" data-id="${esc(id)}" value="${esc(resp)}"${dis} /></div>
      <div><label for="sfa-pr-${esc(id)}">Prazo</label><input id="sfa-pr-${esc(id)}" type="date" data-acao-campo="prazo" data-id="${esc(id)}" value="${esc(prazo)}"${dis} /></div>
      <div class="sf-full"><label for="sfa-no-${esc(id)}">Notas</label><textarea id="sfa-no-${esc(id)}" maxlength="4000" data-acao-campo="notas" data-id="${esc(id)}"${dis}>${esc(notas)}</textarea></div>
      <div class="sf-form-acoes">
        ${D.podeEditar ? `<button type="button" class="btn btn-primary btn-sm" data-requer-edicao data-sf-act="salvar-acao" data-id="${esc(id)}">Salvar</button>` : ""}
        <span class="sf-msg${m ? (m.ok ? " ok" : " erro") : ""}" data-msg-acao="${esc(id)}">${m ? esc(m.texto) : (rascAcao[id] ? "Alterações não salvas" : "")}</span>
      </div>
    </div>
  </article>`;
}

/** "#N" do plano semanal vira link para o cartão da ideia (quando ela existe). */
function linkIdeia(x: unknown): string {
  const t = txt(x).trim();
  const id = `sfa-${t}`;
  if (!/^\d+$/.test(t) || !acaoPorId(id)) return "#" + esc(t);
  return `<a href="#sfa-card-${esc(id)}" data-sf-act="ir-ideia" data-id="${esc(id)}">#${esc(t)}</a>`;
}
/** A revisão achou a meta de vendas agressiva: avisa junto do plano (o alerta completo fica na Visão geral). */
function avisoMetaOtimista(): string {
  const al = arr<{ titulo?: string; texto?: string }>(D.painel.alertas).find((a) => /agressiv|otimist/i.test(`${txt(a.titulo)} ${txt(a.texto)}`));
  const texto = al?.texto || "Com 15% a 20% de conversão das propostas, em vez de 35% a 40%, a venda fica em cerca de metade da meta.";
  return `<div class="sf-box sf-box-amarelo"><strong>Meta otimista (revisão):</strong>${esc(texto)}</div>`;
}
function blocoPlanoVendas(): string {
  const p = D.painel.plano_vendas;
  if (!p || typeof p !== "object") return "";
  const sem = arr<Semana>(p.semanas);
  const tot = (p.totais_8_semanas || {}) as Record<string, unknown>;
  const conhecidos = new Set(["contatos", "conversas", "visitas", "propostas", "fechamentos", "vendido_rs", "caixa_adiantado_rs", "recorrente_contratado_rs_mes", "meta_cobranca"]);
  const outrosTot = Object.entries(tot).filter(([k]) => !conhecidos.has(k));
  const tabela = sem.length ? `<div class="card" style="padding:0;margin-bottom:12px"><div class="table-wrap"><table class="sf-table sf-semanas">
    <thead><tr><th>Semana</th><th>Foco</th><th class="sf-num">Contatos</th><th class="sf-num">Conversas</th><th class="sf-num">Visitas</th><th class="sf-num">Propostas</th><th class="sf-num">Fechamentos</th><th class="sf-num">Vendido</th><th class="sf-num">Caixa entrando</th><th class="sf-num">Recorrente</th><th>Entregas</th></tr></thead>
    <tbody>${sem.map((s) => {
      const ideias = arr(s.ideias_ativas);
      return `<tr>
      <td style="white-space:nowrap"><strong>${esc(s.semana)}</strong><div class="sf-muted">${esc(s.datas || "")}</div></td>
      <td style="min-width:220px">${esc(s.foco || "")}${ideias.length ? `<div class="sf-muted" style="margin-top:3px">Ideias: ${ideias.map(linkIdeia).join(", ")}</div>` : ""}</td>
      <td class="sf-num">${esc(fmtN(s.contatos))}</td><td class="sf-num">${esc(fmtN(s.conversas))}</td><td class="sf-num">${esc(fmtN(s.visitas))}</td>
      <td class="sf-num">${esc(fmtN(s.propostas))}</td><td class="sf-num">${esc(fmtN(s.fechamentos))}</td>
      <td class="sf-num">${esc(fmtR(s.vendido_rs))}</td><td class="sf-num">${esc(fmtR(s.caixa_entrando_rs))}</td><td class="sf-num">${esc(fmtR(s.recorrente_acumulado_rs))}</td>
      <td style="min-width:220px">${lista(arr(s.entregas))}</td></tr>`;
    }).join("")}</tbody>
    ${Object.keys(tot).length ? `<tfoot><tr><td colspan="2">Total das 8 semanas</td>
      <td class="sf-num">${esc(fmtN(tot.contatos))}</td><td class="sf-num">${esc(fmtN(tot.conversas))}</td><td class="sf-num">${esc(fmtN(tot.visitas))}</td>
      <td class="sf-num">${esc(fmtN(tot.propostas))}</td><td class="sf-num">${esc(fmtN(tot.fechamentos))}</td>
      <td class="sf-num">${esc(fmtR(tot.vendido_rs))}</td><td class="sf-num">${esc(fmtR(tot.caixa_adiantado_rs))}</td><td class="sf-num">${num(tot.recorrente_contratado_rs_mes) != null ? esc(fmtR(tot.recorrente_contratado_rs_mes)) + "/mês" : "—"}</td><td></td></tr></tfoot>` : ""}
  </table></div></div>
  ${tot.meta_cobranca ? `<div class="sf-box sf-box-azul"><strong>Meta de cobrança:</strong> ${esc(tot.meta_cobranca)}</div>` : ""}
  ${outrosTot.length ? `<p class="sf-nota">${outrosTot.map(([k, v]) => `<strong>${esc(rotuloChave(k))}:</strong> ${esc(valorLivre(v))}`).join(" · ")}</p>` : ""}` : "";
  const nichos = p.nichos_foco;
  const funil = p.funil;
  const prem = funil?.premissas_de_conversao && typeof funil.premissas_de_conversao === "object" ? Object.entries(funil.premissas_de_conversao) : [];
  const papeis = p.papeis && typeof p.papeis === "object" ? Object.entries(p.papeis) : [];
  const fontes = arr(p.fontes);
  const kpis = Object.keys(tot).length ? `<div class="sf-kpis">
      <div class="sf-kpi"><div class="sf-kpi-v">${esc(fmtR(tot.vendido_rs))}</div><div class="sf-kpi-l">Vendido nas 8 semanas</div></div>
      <div class="sf-kpi"><div class="sf-kpi-v">${esc(fmtR(tot.caixa_adiantado_rs))}</div><div class="sf-kpi-l">Sinais e adiantamentos no caixa</div></div>
      <div class="sf-kpi"><div class="sf-kpi-v">${esc(fmtR(tot.recorrente_contratado_rs_mes))}</div><div class="sf-kpi-l">Receita recorrente por mês</div></div>
      <div class="sf-kpi"><div class="sf-kpi-v">${esc(fmtN(tot.fechamentos))}</div><div class="sf-kpi-l">Fechamentos (${esc(fmtN(tot.contatos))} contatos)</div></div>
    </div>` : "";
  return `<div class="sf-blk" style="margin-top:28px">${blkTitulo("calendar-stats", "Plano de vendas de 8 semanas", p.periodo ? `<span class="sf-tag-salvo">${esc(p.periodo)}</span>` : "")}
    ${p.objetivo ? `<div class="sf-box sf-box-verde"><strong>Objetivo:</strong> ${esc(p.objetivo)}</div>` : ""}
    ${avisoMetaOtimista()}
    ${kpis}
    ${tabela}
    <div class="sf-grid2">
      ${nichos ? `<div class="card"><div class="sf-card-t">Para quem vender</div>
        ${arr(nichos.semanas_1_a_4).length ? `<p class="sf-small"><strong>Semanas 1 a 4</strong></p>${lista(arr(nichos.semanas_1_a_4))}` : ""}
        ${arr(nichos.semanas_5_a_8).length ? `<p class="sf-small" style="margin-top:8px"><strong>Semanas 5 a 8</strong></p>${lista(arr(nichos.semanas_5_a_8))}` : ""}
        ${nichos.regra ? `<p class="sf-nota"><strong>Regra:</strong> ${esc(nichos.regra)}</p>` : ""}</div>` : ""}
      ${funil ? `<div class="card"><div class="sf-card-t">Funil de vendas</div>${lista(arr(funil.etapas))}
        ${prem.length ? `<p class="sf-small" style="margin-top:8px"><strong>Quanto costuma converter</strong></p><ul class="sf-lista">${prem.map(([k, v]) => `<li><strong>${esc(rotuloChave(k))}:</strong> ${esc(v)}</li>`).join("")}</ul>` : ""}</div>` : ""}
      ${arr(p.cadencia_por_alvo).length ? `<div class="card"><div class="sf-card-t">Sequência de contatos com cada cliente</div>${lista(arr(p.cadencia_por_alvo), true)}</div>` : ""}
      ${papeis.length ? `<div class="card"><div class="sf-card-t">Quem faz o quê</div>${papeis.map(([nome, tarefas]) => `<p class="sf-small" style="margin-top:6px"><strong>${esc(nome)}</strong></p>${Array.isArray(tarefas) ? lista(tarefas) : `<p class="sf-small">${esc(tarefas)}</p>`}`).join("")}</div>` : ""}
      ${p.reuniao_de_segunda ? `<div class="card"><div class="sf-card-t">Reunião de segunda-feira</div><p class="sf-small" style="line-height:1.55">${esc(p.reuniao_de_segunda)}</p></div>` : ""}
      ${arr(p.indicadores).length ? `<div class="card"><div class="sf-card-t">O que acompanhar</div>${lista(arr(p.indicadores))}</div>` : ""}
      ${arr(p.gatilhos_de_corte).length ? `<div class="card"><div class="sf-card-t">Quando cortar</div>${lista(arr(p.gatilhos_de_corte))}</div>` : ""}
    </div>
    ${fontes.length ? `<p class="sf-fontes" style="margin-top:12px"><b class="sf-small">Fontes:</b> ${fontes.map(linkSeguro).join(" · ")}</p>` : ""}
  </div>`;
}

// ───────────────────────── 7. Protestos ─────────────────────────
function renderProtestos(): void {
  const sec = el("sfSecProtestos");
  if (!sec) return;
  if (!D.protestos.length) {
    sec.innerHTML = `<div class="empty-state"><strong>Nenhum protesto cadastrado.</strong>${D.faltaMigration ? "As tabelas ainda não foram criadas." : ""}</div>`;
    return;
  }
  const tabs = [...new Set(D.protestos.map((p) => txt(p.tabeliao).trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
  validarFiltro("protTab", tabs);
  validarFiltro("protGrupo", GRUPOS_PROT.map(([v]) => v));
  const soma = (l: SfProtesto[], f: (p: SfProtesto) => unknown) => l.reduce((s, p) => s + n0(f(p)), 0);
  const totProt = soma(D.protestos, (p) => p.valor_protestado);
  const totCustas = soma(D.protestos, (p) => p.custas);
  const pagos = D.protestos.filter(protestoPago);
  const noCpf = D.protestos.filter(protestoNoCpf);
  const intimados = D.protestos.filter((p) => p.secao === "pgfn_intimado");
  const respondidos = D.protestos.filter((p) => txt(p.resposta_cartorio).trim()).length;
  const cont = (k: string) => D.protestos.filter((p) => grupoDoProtesto(p) === k || (k === "pagos" && protestoPago(p))).length;
  sec.innerHTML = `
    <div class="sf-blk">${blkTitulo("gavel", "Títulos protestados e intimações")}
      <div class="sf-box sf-box-azul"><strong>Não some de novo:</strong>estes títulos já estão contados nas abas Impostos, Bancos e Fornecedores. Esta aba serve para acompanhar o cartório (prazo, custas e cancelamento).</div>
      <div class="sf-kpis">
        <div class="sf-kpi"><div class="sf-kpi-v">${D.protestos.length}</div><div class="sf-kpi-l">Títulos na lista</div></div>
        <div class="sf-kpi"><div class="sf-kpi-v sf-neg">${esc(fmtR(totProt))}</div><div class="sf-kpi-l">Valor protestado ou intimado (todos)</div></div>
        <div class="sf-kpi"><div class="sf-kpi-v">${esc(fmtR(soma(intimados, (p) => p.valor_protestado)))}</div><div class="sf-kpi-l">Desse total: intimações da PGFN (${intimados.length}), que podem ainda não ter virado protesto</div></div>
        <div class="sf-kpi"><div class="sf-kpi-v">${esc(fmtR(soma(pagos, (p) => p.valor_protestado)))}</div><div class="sf-kpi-l">Desse total: já pagos na Vobi (${pagos.length}); falta conferir o cancelamento</div></div>
        ${noCpf.length ? `<div class="sf-kpi"><div class="sf-kpi-v">${esc(fmtR(soma(noCpf, (p) => p.valor_protestado)))}</div><div class="sf-kpi-l">No CPF da sócia, não da empresa (${noCpf.length})</div></div>` : ""}
        <div class="sf-kpi"><div class="sf-kpi-v">${esc(fmtR(totCustas))}</div><div class="sf-kpi-l">Custas de cartório</div></div>
        <div class="sf-kpi"><div class="sf-kpi-v">${respondidos} de ${D.protestos.length}</div><div class="sf-kpi-l">Com resposta do cartório</div></div>
      </div>
      <div class="sf-toolbar">
        <select class="filter-select" data-sf-f="protGrupo" aria-label="Tipo de credor">${GRUPOS_PROT.map(([v, r]) => `<option value="${esc(v)}"${filtros.protGrupo === v ? " selected" : ""}>${esc(r)}${v ? ` (${cont(v)})` : ""}</option>`).join("")}</select>
        <select class="filter-select" data-sf-f="protTab" aria-label="Tabelião"><option value="">Todos os tabeliães</option>${tabs.map((t) => `<option value="${esc(t)}"${filtros.protTab === t ? " selected" : ""}>${esc(t)}</option>`).join("")}</select>
        <input type="search" class="search-input" placeholder="Buscar credor, documento, protocolo…" data-sf-f="protBusca" value="${esc(filtros.protBusca)}" aria-label="Buscar protesto" />
      </div>
      <div id="sfProtLista"></div>
    </div>`;
  renderProtLista();
}
const GRUPOS_PROT: Array<[string, string]> = [
  ["", "Todos os credores"], ["imposto", "Impostos"], ["banco", "Bancos"], ["fornecedor", "Fornecedores"], ["pagos", "Já pagos (falta cancelar)"],
];
function grupoDoProtesto(p: SfProtesto): string { return txt(p.grupo).trim() || "fornecedor"; }
function renderProtLista(): void {
  const alvo = el("sfProtLista");
  if (!alvo) return;
  const q = norm(filtros.protBusca);
  const l = D.protestos.filter((p) => {
    if (filtros.protTab && txt(p.tabeliao).trim() !== filtros.protTab) return false;
    if (filtros.protGrupo === "pagos" ? !protestoPago(p) : (filtros.protGrupo && grupoDoProtesto(p) !== filtros.protGrupo)) return false;
    if (q) {
      const s = norm([p.credor, p.credor_cnpj, p.documento, p.protocolo, p.observacao, p.tabeliao, p.situacao_vobi, p.resposta_cartorio].map(txt).join(" "));
      if (!s.includes(q)) return false;
    }
    return true;
  });
  if (!l.length) { alvo.innerHTML = `<div class="empty-state"><strong>Nenhum título com esses filtros.</strong></div>`; return; }
  const hoje = hojeISO();
  const secoes = [...SECOES_PROT];
  for (const p of l) if (!secoes.some(([k]) => k === p.secao)) secoes.push([p.secao, rotuloChave(txt(p.secao) || "Sem seção")]);
  let html = "";
  for (const [chave, rotulo] of secoes) {
    const ps = l.filter((p) => p.secao === chave);
    if (!ps.length) continue;
    const t = ps.reduce((s, p) => ({ pr: s.pr + n0(p.valor_principal), vp: s.vp + n0(p.valor_protestado), cu: s.cu + n0(p.custas) }), { pr: 0, vp: 0, cu: 0 });
    const linhas = ps.map((p) => {
      // o prazo só importa para as intimações ainda não protestadas (PGFN); nos já protestados ele já passou faz tempo
      const prazoVenc = p.secao === "pgfn_intimado" && p.prazo_limite && String(p.prazo_limite).slice(0, 10) < hoje;
      const m = msgProt[p.id];
      const resp = rascProt[p.id] ?? txt(p.resposta_cartorio);
      const respCel = D.podeEditar
        ? `<div class="sf-resp"><textarea rows="2" maxlength="4000" data-prot-id="${esc(p.id)}" aria-label="Resposta do cartório para ${esc(p.credor)}" placeholder="O que o cartório respondeu…">${esc(resp)}</textarea>
            <button type="button" class="btn btn-outline btn-sm" data-requer-edicao data-sf-act="salvar-prot" data-id="${esc(p.id)}">Salvar</button></div>
            <div class="sf-msg${m ? (m.ok ? " ok" : " erro") : ""}" data-msg-prot="${esc(p.id)}">${m ? esc(m.texto) : (rascProt[p.id] != null ? "Não salvo" : "")}</div>`
        : `<div class="sf-obs" style="max-width:none">${esc(resp) || `<span class="sf-muted">—</span>`}</div>`;
      const selos = `${protestoPago(p) ? `<span class="sf-selo-pago" title="Consta como pago na Vobi. Veja a observação para saber se o protesto já foi cancelado.">Pago (Vobi)</span>` : ""}${protestoNoCpf(p) ? `<span class="sf-selo-cpf" title="O protesto está no CPF da sócia, não no CNPJ da empresa.">No CPF da sócia</span>` : ""}`;
      // 2 linhas por título: os dados e, embaixo (largura inteira), a resposta do cartório
      return `<tr class="sf-prot-l1">
        <td class="sf-small">${esc(p.tabeliao)}</td>
        <td class="sf-prot-cred"><strong>${esc(p.credor)}</strong>${selos ? `<div>${selos}</div>` : ""}${p.credor_cnpj ? `<div class="sf-muted">${esc(p.credor_cnpj)}</div>` : ""}${p.situacao_vobi ? `<div class="sf-muted">Na Vobi: ${esc(txt(p.situacao_vobi).replace(/\s+na Vobi$/i, ""))}</div>` : ""}${p.observacao ? `<div class="sf-obs" style="margin-top:3px">${esc(p.observacao)}</div>` : ""}</td>
        <td class="sf-small">${esc(p.documento || "")}</td>
        <td class="sf-num">${esc(fmtR(p.valor_principal))}</td>
        <td class="sf-num">${esc(fmtR(p.valor_protestado))}${p.data_protesto ? `<div class="sf-muted">em ${esc(fmtData(p.data_protesto))}</div>` : ""}</td>
        <td class="sf-num">${esc(fmtR(p.custas))}</td>
        <td style="white-space:nowrap">${esc(fmtData(p.vencimento))}</td>
        <td class="sf-small">${esc(p.protocolo || "")}${p.data_protocolo ? `<div class="sf-muted">${esc(fmtData(p.data_protocolo))}</div>` : ""}</td>
        <td style="white-space:nowrap"${prazoVenc ? ` class="sf-neg" title="Prazo já passou"` : ""}>${esc(fmtData(p.prazo_limite))}</td>
        <td>${badgeConfianca(p.confianca)}</td></tr>
      <tr class="sf-prot-l2"><td></td><td colspan="9"><div class="sf-resp-rot">Resposta do cartório</div>${respCel}</td></tr>`;
    }).join("");
    html += `<div class="sf-blk"><div class="sf-card-t">${esc(rotulo)} <span class="sf-muted">(${ps.length})</span></div>
      <div class="card" style="padding:0"><div class="table-wrap"><table class="sf-table sf-prot">
      <thead><tr><th>Tabelião</th><th>Credor</th><th>Documento</th><th class="sf-num">Valor principal</th><th class="sf-num">Protestado</th><th class="sf-num">Custas</th><th>Vencimento</th><th>Protocolo</th><th>Prazo</th><th>Credor confirmado?</th></tr></thead>
      <tbody>${linhas}</tbody>
      <tfoot><tr><td colspan="3">Total — ${esc(rotulo)} (${ps.length})</td><td class="sf-num">${esc(fmtR(t.pr))}</td><td class="sf-num">${esc(fmtR(t.vp))}</td><td class="sf-num">${esc(fmtR(t.cu))}</td><td colspan="4"></td></tr></tfoot>
      </table></div></div></div>`;
  }
  alvo.innerHTML = html;
}

// ───────────────────────── leitura ao vivo ─────────────────────────
function renderLiveStatus(): void {
  const st = el("sfLiveStatus");
  const btn = el("sfBtnVobi") as HTMLButtonElement | null;
  if (btn) btn.disabled = vivoCarregando;
  if (st) {
    st.className = "sf-live-st";
    st.title = "";
    if (vivoCarregando) {
      st.classList.add("sf-live-loading");
      st.innerHTML = `<span class="spinner"></span> Vobi: ${vivo ? "atualizando…" : "carregando…"}`;
    } else if (vivo) {
      const hora = horaDe(vivo.atualizadoEm);
      if (vivo.fonte === "vobi") {
        st.classList.add("sf-live-ok");
        st.textContent = `Vobi: atualizado às ${hora}`;
      } else {
        st.classList.add(vivo.aviso ? "sf-live-erro" : "sf-live-cache");
        const dia = diaDe(vivo.atualizadoEm);
        const hojeDia = diaDe(new Date().toISOString());
        st.textContent = `Vobi: cópia salva ${dia && dia !== hojeDia ? `de ${dia} ` : ""}às ${hora}`;
        st.title = "Para poupar o limite de consultas da Vobi, a leitura fica guardada por 1 hora.";
      }
    } else {
      st.classList.add("sf-live-erro");
      st.textContent = "Vobi: sem leitura";
    }
  }
  const av = el("sfAviso");
  if (av) {
    const msg = vivo?.aviso || (vivoErro && !vivoCarregando ? vivoErro : "");
    const nota = !msg && !vivoCarregando ? txt(vivo?.nota) : "";
    av.innerHTML = msg ? `<div class="sf-box sf-box-amarelo"><strong>Leitura da Vobi:</strong>${esc(msg)}</div>`
      : (nota ? `<div class="sf-box sf-box-azul">${esc(nota)}</div>` : "");
  }
}
function renderPartesVivas(): void {
  renderLiveStatus();
  renderVisao();
  renderImpostos();
  renderBancos();
  renderFornecedores();
  renderFixas();
}
async function carregarVivo(forcar: boolean): Promise<void> {
  if (vivoCarregando) return;
  vivoCarregando = true;
  vivoErro = "";
  renderLiveStatus();
  try {
    const r = await fetch("/api/admin/situacao-financeira/aovivo" + (forcar ? "?forcar=1" : ""), { headers: { accept: "application/json" } });
    let j: unknown = null;
    try { j = await r.json(); } catch { j = null; }
    if (!r.ok) {
      const msg = j && typeof j === "object" && "error" in j ? txt((j as { error?: unknown }).error) : "";
      if (r.status === 401) throw new Error("Sua sessão expirou. Entre de novo no portal.");
      if (r.status === 429) throw new Error(msg || "A Vobi atingiu o limite de consultas desta hora. Tente de novo mais tarde.");
      throw new Error(msg || `A leitura falhou (erro ${r.status}).`);
    }
    const dados = j as DadosAoVivo | null;
    if (!dados || !Array.isArray(dados.fluxo)) throw new Error("A resposta da Vobi veio incompleta.");
    vivo = dados;
  } catch (e) {
    vivoErro = e instanceof Error ? e.message : String(e);
  } finally {
    vivoCarregando = false;
    vivoTentado = true;
    renderPartesVivas();
  }
}
function sfAtualizarVobi(): void { void carregarVivo(true); }

// ───────────────────────── gravações ─────────────────────────
async function patchJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const r = await fetch(url, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  let j: unknown = null;
  try { j = await r.json(); } catch { j = null; }
  if (!r.ok) {
    const msg = j && typeof j === "object" && "error" in j ? txt((j as { error?: unknown }).error) : "";
    if (r.status === 401) throw new Error("Sua sessão expirou. Entre de novo.");
    if (r.status === 403) throw new Error(msg || "Você não tem permissão para alterar.");
    throw new Error(msg || `Não salvou (erro ${r.status}).`);
  }
  return j as T;
}
function agora(): string { return new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); }
function setMsg(attr: string, id: string, m: Msg | null, texto?: string): void {
  const alvo = document.querySelector<HTMLElement>(`[${attr}="${CSS.escape(id)}"]`);
  if (!alvo) return;
  alvo.className = "sf-msg" + (m ? (m.ok ? " ok" : " erro") : "");
  alvo.textContent = m ? m.texto : (texto || "");
}

async function sfSalvarAcao(id: string): Promise<void> {
  const a = acaoPorId(id);
  if (!a) return;
  const r = rascAcao[id] || {};
  const status = r.status ?? a.status ?? "ideia";
  const responsavel = (r.responsavel ?? a.responsavel ?? "").trim();
  const prazo = (r.prazo ?? (a.prazo ? String(a.prazo).slice(0, 10) : "")).trim();
  const notas = (r.notas ?? a.notas ?? "").trim();
  if (!D.statusAcao.includes(status)) { msgAcao[id] = { ok: false, texto: "Situação inválida." }; setMsg("data-msg-acao", id, msgAcao[id]); return; }
  if (prazo && !/^\d{4}-\d{2}-\d{2}$/.test(prazo)) { msgAcao[id] = { ok: false, texto: "Prazo inválido." }; setMsg("data-msg-acao", id, msgAcao[id]); return; }
  if (responsavel.length > 80) { msgAcao[id] = { ok: false, texto: "Responsável: no máximo 80 letras." }; setMsg("data-msg-acao", id, msgAcao[id]); return; }
  const btn = document.querySelector<HTMLButtonElement>(`[data-sf-act="salvar-acao"][data-id="${CSS.escape(id)}"]`);
  if (btn) btn.disabled = true;
  setMsg("data-msg-acao", id, null, "Salvando…");
  try {
    const linha = await patchJson<Partial<SfAcao>>(`/api/admin/situacao-financeira/acoes/${encodeURIComponent(id)}`, {
      status, responsavel: responsavel || null, prazo: prazo || null, notas: notas || null,
    });
    const i = D.acoes.findIndex((x) => x.id === id);
    if (i >= 0) {
      D.acoes[i] = { ...D.acoes[i], status: status as SfAcao["status"], responsavel: responsavel || null, prazo: prazo || null, notas: notas || null, ...(linha && typeof linha === "object" ? linha : {}) };
    }
    delete rascAcao[id];
    msgAcao[id] = { ok: true, texto: `Salvo às ${agora()}` };
    setMsg("data-msg-acao", id, msgAcao[id]);
    // o selo aparece no cartão da ideia e, se ela for do top 10, também na lista do topo
    document.querySelectorAll<HTMLElement>(`[data-badge-acao="${CSS.escape(id)}"]`).forEach((b) => { b.innerHTML = badgeStatus(D.acoes[i >= 0 ? i : 0]?.status || status); });
    renderPlanoContadores();
  } catch (e) {
    msgAcao[id] = { ok: false, texto: e instanceof Error ? e.message : String(e) };
    setMsg("data-msg-acao", id, msgAcao[id]);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function sfSalvarProtesto(id: string): Promise<void> {
  const p = D.protestos.find((x) => x.id === id);
  if (!p) return;
  const resp = (rascProt[id] ?? txt(p.resposta_cartorio)).trim();
  const btn = document.querySelector<HTMLButtonElement>(`[data-sf-act="salvar-prot"][data-id="${CSS.escape(id)}"]`);
  if (btn) btn.disabled = true;
  setMsg("data-msg-prot", id, null, "Salvando…");
  try {
    const linha = await patchJson<Partial<SfProtesto>>(`/api/admin/situacao-financeira/protestos/${encodeURIComponent(id)}`, {
      resposta_cartorio: resp || null,
    });
    const i = D.protestos.findIndex((x) => x.id === id);
    if (i >= 0) D.protestos[i] = { ...D.protestos[i], resposta_cartorio: resp || null, ...(linha && typeof linha === "object" ? linha : {}) };
    delete rascProt[id];
    msgProt[id] = { ok: true, texto: `Salvo às ${agora()}` };
    setMsg("data-msg-prot", id, msgProt[id]);
  } catch (e) {
    msgProt[id] = { ok: false, texto: e instanceof Error ? e.message : String(e) };
    setMsg("data-msg-prot", id, msgProt[id]);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── editar dívida (modal) ──
function valorParaCampo(v: unknown): string {
  const n = num(v);
  return n == null ? "" : n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
/** "1.234,56", "1234,56", "1234.56" ou "R$ 1.234,56" → número; "" → null; inválido → NaN.
 *  Formato americano ("1,234.56": ponto depois da vírgula) é recusado: viraria R$ 1,23 sem avisar. */
function lerValor(s: string): number | null {
  let t = s.replace(/R\$/gi, "").replace(/\s/g, "").trim();
  if (!t) return null;
  if (t.includes(",") && t.includes(".") && t.lastIndexOf(".") > t.lastIndexOf(",")) return NaN;
  if ((t.match(/,/g) || []).length > 1) return NaN;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}
function campo(id: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null {
  return document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
}
function sfEditarDivida(id: string): void {
  const d = D.dividas.find((x) => x.id === id);
  const modal = el("sfModalDivida");
  if (!d || !modal) return;
  const sel = campo("sfMdSituacao") as HTMLSelectElement | null;
  if (sel) {
    const atual = txt(d.situacao).trim();
    const k = chaveSituacao(atual);
    const opts = [`<option value="">— sem situação —</option>`]
      .concat(Object.entries(SITUACOES).map(([v, [r]]) => `<option value="${esc(v)}"${k === v ? " selected" : ""}>${esc(r)}</option>`));
    if (atual && !SITUACOES[k]) opts.push(`<option value="${esc(atual)}" selected>${esc(atual)}</option>`);
    sel.innerHTML = opts.join("");
  }
  const set = (cid: string, v: string) => { const c = campo(cid); if (c) c.value = v; };
  set("sfMdId", d.id);
  set("sfMdValor", valorParaCampo(d.valor));
  set("sfMdTeto", valorParaCampo(d.valor_teto));
  set("sfMdParcela", valorParaCampo(d.parcela_mensal));
  set("sfMdRisco", d.risco || "");
  set("sfMdObs", d.observacao || "");
  const cred = el("sfMdCredor");
  if (cred) cred.textContent = [d.credor, d.identificacao].filter(Boolean).join(" — ");
  const msg = el("sfMdMsg");
  if (msg) { msg.className = "sf-msg"; msg.textContent = ""; }
  const salvar = el("sfMdSalvar") as HTMLButtonElement | null;
  if (salvar) salvar.disabled = !D.podeEditar;
  modal.classList.add("open");
}
function sfFecharDivida(): void { el("sfModalDivida")?.classList.remove("open"); }
async function sfSalvarDivida(): Promise<void> {
  const id = campo("sfMdId")?.value || "";
  const msg = el("sfMdMsg");
  const erro = (t: string) => { if (msg) { msg.className = "sf-msg erro"; msg.textContent = t; } };
  if (!id) return;
  const valores: Record<string, number | null> = {};
  const nomes: Array<[string, string, string]> = [["valor", "sfMdValor", "Valor de hoje"], ["valor_teto", "sfMdTeto", "Valor máximo"], ["parcela_mensal", "sfMdParcela", "Parcela por mês"]];
  for (const [k, cid, rot] of nomes) {
    const v = lerValor(campo(cid)?.value || "");
    if (v != null && (Number.isNaN(v) || v < 0)) { erro(`${rot}: valor inválido. Use números, ex.: 1.234,56`); return; }
    valores[k] = v;
  }
  const body: Record<string, unknown> = {
    situacao: (campo("sfMdSituacao")?.value || "").trim() || null,
    ...valores,
    risco: (campo("sfMdRisco")?.value || "").trim() || null,
    observacao: (campo("sfMdObs")?.value || "").trim() || null,
  };
  const btn = el("sfMdSalvar") as HTMLButtonElement | null;
  if (btn) btn.disabled = true;
  if (msg) { msg.className = "sf-msg"; msg.textContent = "Salvando…"; }
  try {
    const linha = await patchJson<Partial<SfDivida>>(`/api/admin/situacao-financeira/dividas/${encodeURIComponent(id)}`, body);
    const i = D.dividas.findIndex((x) => x.id === id);
    if (i >= 0) D.dividas[i] = { ...D.dividas[i], ...(body as Partial<SfDivida>), ...(linha && typeof linha === "object" ? linha : {}) };
    sfFecharDivida();
    renderVisao();
    renderImpostos();
    renderBancos();
    renderFornecedores();
  } catch (e) {
    erro(e instanceof Error ? e.message : String(e));
  } finally {
    if (btn) btn.disabled = !D.podeEditar;
  }
}

// ───────────────────────── abas ─────────────────────────
const ABAS = ["visao", "impostos", "bancos", "fornecedores", "fixas", "plano", "protestos"];
function ativarAba(tab: string): void {
  const t = ABAS.includes(tab) ? tab : "visao";
  document.querySelectorAll<HTMLElement>("#sfPills .pill").forEach((p) => p.classList.toggle("active", p.dataset.tab === t));
  document.querySelectorAll<HTMLElement>("section[data-sec]").forEach((s) => { s.style.display = s.dataset.sec === t ? "" : "none"; });
  lsSet("sf:aba", t);
}
function sfTab(btn: HTMLElement): void { ativarAba(btn.dataset.tab || "visao"); }
function irParaIdeia(id: string): void {
  let card = document.getElementById(`sfa-card-${id}`);
  if (!card) {
    // a ideia pode estar escondida por um filtro: limpa os filtros do plano e tenta de novo
    filtros.onda = ""; filtros.dificuldade = ""; filtros.investimento = ""; filtros.status = ""; filtros.busca = "";
    const a = acaoPorId(id);
    if (a?.descartada) filtros.descartadas = true;
    salvarFiltros();
    renderPlano();
    card = document.getElementById(`sfa-card-${id}`);
  }
  if (!card) return;
  card.scrollIntoView({ behavior: "smooth", block: "start" });
  card.classList.add("sf-alvo");
  window.setTimeout(() => card?.classList.remove("sf-alvo"), 2200);
}

// ───────────────────────── eventos (delegação) ─────────────────────────
function aoFiltrar(alvo: HTMLElement): void {
  const k = alvo.dataset.sfF as keyof Filtros | undefined;
  if (!k || !(k in filtros)) return;
  if (k === "descartadas") filtros.descartadas = (alvo as HTMLInputElement).checked;
  else (filtros as Record<string, unknown>)[k] = (alvo as HTMLInputElement | HTMLSelectElement).value;
  salvarFiltros();
  if (k === "fornBusca" || k === "fornOrdem") renderFornLista();
  else if (k === "protTab" || k === "protGrupo" || k === "protBusca") renderProtLista();
  else { renderPlanoLista(); if (k === "status") renderPlanoContadores(); }
}
function aoEditarCampo(alvo: HTMLElement): void {
  const campoAcao = alvo.dataset.acaoCampo as keyof RascunhoAcao | undefined;
  const id = alvo.dataset.id;
  if (campoAcao && id) {
    const r = rascAcao[id] || (rascAcao[id] = {});
    r[campoAcao] = (alvo as HTMLInputElement).value;
    delete msgAcao[id];
    setMsg("data-msg-acao", id, null, "Alterações não salvas");
    return;
  }
  const pid = alvo.dataset.protId;
  if (pid) {
    rascProt[pid] = (alvo as HTMLTextAreaElement).value;
    delete msgProt[pid];
    setMsg("data-msg-prot", pid, null, "Não salvo");
  }
}
document.addEventListener("input", (e) => {
  const alvo = e.target as HTMLElement | null;
  if (!alvo || !alvo.dataset) return;
  if (alvo.dataset.sfF && alvo.tagName !== "SELECT" && (alvo as HTMLInputElement).type !== "checkbox") aoFiltrar(alvo);
  else if (alvo.dataset.acaoCampo || alvo.dataset.protId) aoEditarCampo(alvo);
});
document.addEventListener("change", (e) => {
  const alvo = e.target as HTMLElement | null;
  if (!alvo || !alvo.dataset) return;
  if (alvo.dataset.sfF && (alvo.tagName === "SELECT" || (alvo as HTMLInputElement).type === "checkbox")) aoFiltrar(alvo);
  else if (alvo.dataset.acaoCampo) aoEditarCampo(alvo);
});
function aoAcionar(t: HTMLElement, e: Event): void {
  const act = t.dataset.sfAct;
  const id = t.dataset.id || "";
  if (act === "ir-aba") { ativarAba(t.dataset.aba || "visao"); window.scrollTo({ top: 0, behavior: "smooth" }); }
  else if (act === "ir-outros") { const d = el("sfOutros") as HTMLDetailsElement | null; if (d) { d.open = true; d.scrollIntoView({ behavior: "smooth", block: "start" }); } }
  else if (act === "ir-ideia") { e.preventDefault(); irParaIdeia(id); }
  else if (act === "filtro-status") {
    const v = t.dataset.v || "";
    filtros.status = filtros.status === v ? "" : v;
    salvarFiltros();
    const sel = document.querySelector<HTMLSelectElement>(`select[data-sf-f="status"]`);
    if (sel) sel.value = filtros.status;
    renderPlanoContadores();
    renderPlanoLista();
  }
  else if (act === "salvar-acao") void sfSalvarAcao(id);
  else if (act === "salvar-prot") void sfSalvarProtesto(id);
  else if (act === "editar-divida") sfEditarDivida(id);
}
document.addEventListener("click", (e) => {
  const t = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-sf-act]");
  if (t) aoAcionar(t, e);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && el("sfModalDivida")?.classList.contains("open")) { sfFecharDivida(); return; }
  if (e.key === "Enter" || e.key === " ") {
    const t = (e.target as HTMLElement | null);
    if (t && t.getAttribute("role") === "button" && t.dataset.sfAct) { e.preventDefault(); aoAcionar(t, e); }
  }
});

// handlers usados nos onclick do HTML (o módulo não cria globais sozinho)
Object.assign(window, { sfTab, sfAtualizarVobi, sfSalvarAcao, sfSalvarProtesto, sfEditarDivida, sfFecharDivida, sfSalvarDivida });

// ───────────────────────── início ─────────────────────────
ativarAba(lsGet("sf:aba") || "visao");
renderVisao();
renderImpostos();
renderBancos();
renderFornecedores();
renderFixas();
renderPlano();
renderProtestos();
void carregarVivo(false);
