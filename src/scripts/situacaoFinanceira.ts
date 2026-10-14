// Script da aba Situação Financeira v2 (/admin/situacao-financeira) — 14/10/2026.
// Módulo próprio (o <script> grande direto na página some do SSR — ver ativoDetalhe.ts).
// Lê os dados do banco pelo island JSON #sfData e busca a parte ao vivo da Vobi em
// GET /api/admin/situacao-financeira/aovivo (cache de 1 h no servidor; ?forcar=1 refaz).
// Gravações (sempre com content-type JSON: CSRF do Astro):
//   PATCH .../dividas/{id}   proposta de quitação, quitada, valor pago, a vencer, cobrança, "não vai acontecer",
//                            fornecedor na Vobi… ("✓ Quitei" numa linha com a vencer paga SÓ o vencido: a linha
//                            segue aberta com o comprometido e valor_pago guarda o que já foi pago do vencido)
//   PATCH .../acoes/{id}     situação e "vendi R$" do plano v2
//   PATCH .../protestos/{id} resposta do cartório, cancelado
//   POST  .../reaver, PATCH/DELETE .../reaver/{id}
//   POST  .../sincronizar    depois do "Atualizar da Vobi": vencido / a vencer das dívidas ligadas a um fornecedor
// Todos os números do Painel são calculados AQUI a partir das linhas: mudam na hora a cada edição.
// Regra (Adriana, 14/10/2026): DÍVIDA = só o VENCIDO; o a vencer é despesa COMPROMETIDA, fora da dívida e da meta.
// Um "a vencer" cuja data gravada já passou vira vencido na tela (estimado pela parcela) até ser atualizado.
// Só `import type` do lib: nada do servidor (supabase) entra no pacote do navegador.
import type { SfDivida, SfProtesto, SfAcao, SfReaver, DadosAoVivo, FluxoMes } from "../lib/situacaoFinanceira";

// ───────────────────────── tipos da ilha ─────────────────────────
type Num = number | string | null | undefined;
type Painel = {
  meta?: { margem?: Num; tributo?: Num; fixo_mensal?: Num };
  despesas_fixas?: { total_mensal?: Num; data_ref?: string | null };
  data_ref?: string | null;
};
type AcaoV1 = { id: string; codigo: number | null; titulo: string; onda: number | null; descartada: boolean };
type Ilha = {
  faltaMigration: boolean; erro: string | null;
  dividas: SfDivida[]; protestos: SfProtesto[]; acoes: SfAcao[]; acoesV1: AcaoV1[]; reaver: SfReaver[]; painel: Painel;
  statusAcao: string[]; rotuloStatus: Record<string, string>;
  tiposReaver: string[]; rotuloTipoReaver: Record<string, string>;
  chances: string[]; rotuloChance: Record<string, string>;
  cobrancas: string[]; rotuloCobranca: Record<string, string>; situacoesComCobranca: string[];
  podeEditar: boolean;
};
type Tipo = "imposto" | "banco" | "fornecedor" | "outro";

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
const FMT_R0 = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0, maximumFractionDigits: 0 });
const FMT_N = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
function fmtR(v: unknown): string { const n = num(v); return n == null ? "—" : FMT_R.format(n); }
/** Reais arredondados para card: "R$ 1,2 mi", "R$ 90 mil", "R$ 4,4 mil", "R$ 950". */
function fmtCurto(v: unknown): string {
  const n = num(v);
  if (n == null) return "—";
  const a = Math.abs(n);
  const s = n < 0 ? "−" : "";
  const f = (x: number, casas: number) => x.toLocaleString("pt-BR", { maximumFractionDigits: casas });
  // escala escolhida DEPOIS de arredondar: 999.600 vira "R$ 1 mi", não "R$ 1.000 mil"
  if (a >= 999500) return `${s}R$ ${f(a / 1e6, a < 1e7 ? 2 : 1)} mi`;
  if (a >= 1e4) return `${s}R$ ${f(Math.round(a / 1e3), 0)} mil`;
  if (a >= 1e3) return `${s}R$ ${f(a / 1e3, 1)} mil`;
  return `${s}${FMT_R0.format(Math.round(a))}`;
}
function fmtPct(v: number): string {
  if (v > 0 && v < 0.1) return "menos de 0,1%";
  return FMT_N.format(Math.round(v * 10) / 10) + "%";
}
function fmtData(v: unknown): string {
  const s = txt(v).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (s || "—");
}
function fmtDataCurta(v: unknown): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(txt(v).trim());
  return m ? `${m[3]}/${m[2]}` : "";
}
function hojeISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
/** Mês ("AAAA-MM") de um instante, no fuso de São Paulo; "" se inválido. */
function mesSP(iso: unknown): string {
  const d = new Date(txt(iso));
  if (isNaN(d.getTime())) return "";
  try {
    const s = d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
    return /^\d{4}-\d{2}/.test(s) ? s.slice(0, 7) : "";
  } catch {
    return "";
  }
}
const MES_ABREV = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
/** "2026-07" e "2026-09" → "jul–set" (com o ano quando muda). */
function faixaMeses(de: string, ate: string): string {
  const [a1, m1] = de.split("-");
  const [a2, m2] = ate.split("-");
  const r1 = MES_ABREV[Number(m1) - 1] || m1;
  const r2 = MES_ABREV[Number(m2) - 1] || m2;
  if (de === ate) return `${r1}/${String(a1).slice(2)}`;
  return a1 === a2 ? `${r1}–${r2}` : `${r1}/${String(a1).slice(2)}–${r2}/${String(a2).slice(2)}`;
}
function horaDe(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
function diaDe(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
function norm(s: unknown): string {
  return txt(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
function chaveSituacao(s: unknown): string {
  return txt(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim().replace(/[\s-]+/g, "_");
}
function lsGet(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k: string, v: string): void { try { localStorage.setItem(k, v); } catch { /* sem storage */ } }
function pctBarra(v: number): string {
  if (!(v > 0)) return "0";
  return Math.min(100, Math.max(1.5, v)).toFixed(2); // um pouquinho visível mesmo quando é 0,01%
}
/** "1.234,56" → texto do campo. */
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

// ───────────────────────── estado ─────────────────────────
function lerIlha(): Ilha {
  const vazio: Ilha = {
    faltaMigration: false, erro: null, dividas: [], protestos: [], acoes: [], acoesV1: [], reaver: [], painel: {},
    statusAcao: ["ideia", "testando", "em_andamento", "feito", "descartado"],
    rotuloStatus: { ideia: "Ideia", testando: "Testando", em_andamento: "Em andamento", feito: "Feito", descartado: "Descartado" },
    tiposReaver: ["processo", "credito_tributario", "consorcio", "outro"],
    rotuloTipoReaver: { processo: "Processos", credito_tributario: "Créditos tributários", consorcio: "Consórcios", outro: "Outros" },
    chances: ["alta", "media", "baixa", "nao_sei"],
    rotuloChance: { alta: "Alta", media: "Média", baixa: "Baixa", nao_sei: "Não sei" },
    cobrancas: ["com_cobranca", "sem_cobranca"],
    rotuloCobranca: { com_cobranca: "Com cobrança", sem_cobranca: "Sem cobrança" },
    situacoesComCobranca: ["protestada", "intimada", "execucao", "ajuizada", "citada", "inscrita"],
    podeEditar: false,
  };
  try {
    const b = JSON.parse(el("sfData")?.textContent || "{}") as Partial<Ilha>;
    return {
      ...vazio, ...b,
      dividas: arr<SfDivida>(b.dividas), protestos: arr<SfProtesto>(b.protestos), acoes: arr<SfAcao>(b.acoes),
      acoesV1: arr<AcaoV1>(b.acoesV1), reaver: arr<SfReaver>(b.reaver),
      painel: (b.painel && typeof b.painel === "object" ? b.painel : {}) as Painel,
      statusAcao: arr<string>(b.statusAcao).length ? arr<string>(b.statusAcao) : vazio.statusAcao,
      rotuloStatus: { ...vazio.rotuloStatus, ...(b.rotuloStatus || {}) },
      tiposReaver: arr<string>(b.tiposReaver).length ? arr<string>(b.tiposReaver) : vazio.tiposReaver,
      rotuloTipoReaver: { ...vazio.rotuloTipoReaver, ...(b.rotuloTipoReaver || {}) },
      chances: arr<string>(b.chances).length ? arr<string>(b.chances) : vazio.chances,
      rotuloChance: { ...vazio.rotuloChance, ...(b.rotuloChance || {}) },
      cobrancas: arr<string>(b.cobrancas).length ? arr<string>(b.cobrancas) : vazio.cobrancas,
      rotuloCobranca: { ...vazio.rotuloCobranca, ...(b.rotuloCobranca || {}) },
      situacoesComCobranca: arr<string>(b.situacoesComCobranca).length ? arr<string>(b.situacoesComCobranca) : vazio.situacoesComCobranca,
      podeEditar: b.podeEditar === true,
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

const PRAZOS = [12, 24, 36];
const PRAZO_IMPOSTO = 60; // parcelamento ordinário da PGFN (a transação está vedada até 18/12/2027)
let prazo = (() => { const v = Number(lsGet("sf:prazo")); return PRAZOS.includes(v) ? v : 24; })();
function prazoDe(t: Tipo): number { return t === "imposto" ? PRAZO_IMPOSTO : prazo; }

/** Rascunho da resposta do cartório (não salva sozinho) e a última mensagem de cada protesto. */
const rascProt: Record<string, string> = {};
const msgProt: Record<string, { ok: boolean; texto: string }> = {};
/** Estado aberto/fechado dos grupos recolhíveis (sobrevive ao redesenho da aba). */
const detAberto = new Map<string, boolean>();

// ───────────────────────── contas das dívidas ─────────────────────────
const TIPOS: Tipo[] = ["imposto", "banco", "fornecedor", "outro"];
const TIPO_INFO: Record<Tipo, { nome: string; aba: string; sec: string; ic: string; cor: string }> = {
  imposto: { nome: "Impostos", aba: "impostos", sec: "sfSecImpostos", ic: "receipt-tax", cor: "#B91C1C" },
  banco: { nome: "Bancos", aba: "bancos", sec: "sfSecBancos", ic: "building-bank", cor: "#1D4ED8" },
  fornecedor: { nome: "Fornecedores", aba: "fornecedores", sec: "sfSecFornecedores", ic: "truck", cor: "#EA580C" },
  outro: { nome: "Outras", aba: "outras", sec: "sfSecOutras", ic: "users", cor: "#7C3AED" },
};
/** Por que a linha NÃO entra na conta da dívida da empresa (null = entra). */
function motivoFora(d: SfDivida): string | null {
  const sub = txt(d.subgrupo);
  if (/pessoa f[ií]sica|fora da empresa/i.test(sub)) return "fora da empresa — não entra na conta";
  if (d.grupo === "fornecedor" && /^contingente$/i.test(sub.trim())) return "contingente — só é devido se o crédito compensar; fora da conta";
  // como no levantamento: sócios são o último da fila e "a conferir" tem como credor a própria empresa
  if (d.grupo === "outro" && /^s[oó]cios$/i.test(sub.trim())) return "sócios — último da fila; fora da conta";
  if (/^a conferir$/i.test(sub.trim())) return "a conferir — fora da conta";
  return null;
}
function contaNaDivida(d: SfDivida): boolean { return d.ativo !== false && !motivoFora(d); }

// Regra da Adriana (14/10/2026): DÍVIDA = só o que JÁ VENCEU e não foi pago (com ou sem cobrança). O que vence
// depois é despesa COMPROMETIDA: fica fora da dívida, da meta e das próximas vitórias (pode deixar de acontecer).
// valor = vencido; valor_a_vencer = comprometido (migration 120). Toda a conta passa por divisao(d).
/** Linha declarada "em dia": situação "Em dia", ou "Em acordo" com a observação começando por "em dia" (acordo
 *  sendo cumprido, ex.: rescisões parceladas). Nada dela venceu sem pagar. */
function declaradaEmDia(d: SfDivida): boolean {
  const k = chaveSituacao(d.situacao);
  if (k === "em_dia") return true;
  return k === "acordo" && /^em dia\b/.test(norm(d.observacao));
}
/** Linha antiga, ainda sem o "a vencer" separado, declarada em dia: nada dela venceu — o valor é todo a vencer
 *  (até a sincronização com a Vobi ou alguém separar no ✎). Ex.: Evandio R$ 31.800 que vence em 01/12. */
function emDiaSemSeparar(d: SfDivida): boolean {
  return num(d.valor_a_vencer) == null && declaradaEmDia(d);
}
function dataISO(v: unknown): string | null {
  const s = txt(v).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
/** Soma n meses a uma data AAAA-MM-DD (dia 31 vira o último dia do mês quando ele não existe). */
function somaMeses(iso: string, n: number): string {
  const [a, m, d] = iso.split("-").map(Number);
  const ultimo = new Date(Date.UTC(a, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(a, m - 1 + n, Math.min(d, ultimo))).toISOString().slice(0, 10);
}
const r2 = (v: number) => Math.round(v * 100) / 100;
type Divisao = {
  vencido: number; aVencer: number; proximo: string | null;
  /** quanto do "a vencer" gravado a tela passou para o vencido porque o próximo vencimento já passou (estimativa:
   *  pela parcela por mês, ou tudo quando não há parcela) — até alguém atualizar no ✎ ou pela Vobi */
  estimado: number; venceuEm: string | null;
  /** sem valor de hoje: o vencido é desconhecido (conta 0 e ganha o selo "sem valor") */
  semValor: boolean;
};
/** Vencido / a vencer / próximo vencimento como a tela usa. Vencido = valor de hoje (piso): sem valor de hoje
 *  conta 0 e ganha o selo "sem valor" — contar pelo teto inflava os bancos acima do teto do levantamento.
 *  Um "a vencer" cuja data já passou NÃO continua comprometido: vira vencido (estimado) até ser atualizado. */
function divisao(d: SfDivida): Divisao {
  const sep = emDiaSemSeparar(d);
  const valor = num(d.valor);
  let venc = sep ? 0 : Math.max(0, valor ?? 0);
  let av = sep ? Math.max(0, valor ?? 0) : Math.max(0, num(d.valor_a_vencer) ?? 0);
  let pv = dataISO(d.proximo_vencimento);
  let estimado = 0;
  let venceuEm: string | null = null;
  const hoje = hojeISO();
  if (av > 0 && pv && pv < hoje && !d.quitada && !d.comprometida_cortada) {
    venceuEm = pv;
    const parc = num(d.parcela_mensal);
    if (parc != null && parc > 0) {
      let n = 0;
      let prox = pv;
      while (prox < hoje && n < 600) { n++; prox = somaMeses(pv, n); }
      estimado = Math.min(av, r2(n * parc));
      av = r2(av - estimado);
      pv = av > 0 ? prox : null;
    } else {
      estimado = av;
      av = 0;
      pv = null;
    }
    venc = r2(venc + estimado);
  }
  // sem valor de hoje e sem declarar "em dia": o vencido é desconhecido (mesmo com saldo a vencer, ex.: banco
  // com adimplência a levantar) — fica visível nas vencidas com o selo, sem inflar a dívida
  const semValor = valor == null && !declaradaEmDia(d) && estimado === 0;
  return { vencido: venc, aVencer: av, proximo: pv, estimado, venceuEm, semValor };
}
function vencido(d: SfDivida): number { return divisao(d).vencido; }
/** A vencer (comprometido): parcelas futuras. */
function aVencer(d: SfDivida): number { return divisao(d).aVencer; }
/** O que conta como dívida = o vencido. */
function devido(d: SfDivida): number { return vencido(d); }
/** Vencido de valor desconhecido: conta 0 e ganha o selo "sem valor". */
function semValor(d: SfDivida): boolean { return divisao(d).semValor; }
/** Em aberto = não quitada e com algo VENCIDO (ou vencido sem valor conhecido). Só "a vencer" não é dívida. */
function emAberto(d: SfDivida): boolean { return !d.quitada && (vencido(d) > 0 || semValor(d)); }
/** Despesa comprometida (a vencer) ainda valendo: não quitada, com a vencer e não cortada. */
function comprometida(d: SfDivida): boolean { return !d.quitada && aVencer(d) > 0 && !d.comprometida_cortada; }
/** O que já foi pago do VENCIDO de uma linha que continua aberta (ela tem a vencer): "✓ Paguei o vencido".
 *  Em linha aberta, valor_pago guarda a soma desses pagamentos e quitada_em a data do último. */
function pagoParcial(d: SfDivida): number { return d.quitada ? 0 : Math.max(0, n0(d.valor_pago)); }
type Cobranca = "com_cobranca" | "sem_cobranca";
/** Com cobrança = o credor cobra ativamente: protesto, intimação, execução/ação, citação, cobrança jurídica ou
 *  dívida ativa. Vale o campo da linha; vazio = deduz pela situação e, nos fornecedores, pelo subgrupo. */
function cobrancaDe(d: SfDivida): Cobranca {
  if (d.cobranca === "com_cobranca" || d.cobranca === "sem_cobranca") return d.cobranca;
  return cobrancaDerivada(d);
}
function cobrancaDerivada(d: SfDivida): Cobranca {
  if (D.situacoesComCobranca.includes(chaveSituacao(d.situacao))) return "com_cobranca";
  const sub = txt(d.subgrupo);
  if (!/\bsem cobran/i.test(sub) && /\bcom (cobran|protest)|cobran[çc]a jur[ií]dica|protest|execu[çc][ãa]o|d[ií]vida ativa/i.test(sub)) return "com_cobranca";
  return "sem_cobranca";
}
function realista(d: SfDivida): number { return num(d.valor_proposta) ?? devido(d); }
function pagoDe(d: SfDivida): number { return num(d.valor_pago) ?? realista(d); }
/** O que saiu da lista ao quitar: o devido; se a linha não tinha valor, o que foi pago. */
function eliminadoDe(d: SfDivida): number { return devido(d) || n0(d.valor_pago); }

type Stats = {
  devidoAberto: number; realistaAberto: number; eliminado: number; pago: number;
  /** qtdTotal = quitadas + em aberto (linha só "a vencer" não é dívida e não entra na contagem) */
  qtdQuitadas: number; qtdAbertas: number; qtdTotal: number; economia: number; progresso: number;
  /** linhas em aberto sem valor de hoje (contam 0 até alguém informar) */
  semValor: number;
  /** vencido em aberto que já está sendo cobrado (protesto, execução, dívida ativa…) */
  comCobranca: number;
  /** comprometido: a vencer das linhas não quitadas e não cortadas; cortado = o que ela marcou "não vai acontecer" */
  aVencer: number; cortado: number;
};
function stats(l: SfDivida[]): Stats {
  const s: Stats = {
    devidoAberto: 0, realistaAberto: 0, eliminado: 0, pago: 0, qtdQuitadas: 0, qtdAbertas: 0, qtdTotal: 0,
    economia: 0, progresso: 0, semValor: 0, comCobranca: 0, aVencer: 0, cortado: 0,
  };
  for (const d of l) {
    if (d.quitada) {
      s.eliminado += eliminadoDe(d); s.pago += pagoDe(d); s.qtdQuitadas++;
      continue;
    }
    // vencido já pago de uma linha que segue aberta (só com o a vencer): sai da dívida e conta no progresso
    const pp = pagoParcial(d);
    if (pp > 0) { s.eliminado += pp; s.pago += pp; }
    if (emAberto(d)) {
      s.qtdAbertas++;
      s.devidoAberto += devido(d); s.realistaAberto += realista(d);
      if (cobrancaDe(d) === "com_cobranca") s.comCobranca += devido(d);
      if (semValor(d)) s.semValor++;
      const p = num(d.valor_proposta);
      if (p != null) s.economia += devido(d) - p;
    }
    if (aVencer(d) > 0) {
      if (d.comprometida_cortada) s.cortado += aVencer(d);
      else s.aVencer += aVencer(d);
    }
  }
  s.qtdTotal = s.qtdQuitadas + s.qtdAbertas;
  const base = s.eliminado + s.devidoAberto;
  s.progresso = base > 0 ? (s.eliminado / base) * 100 : 0;
  return s;
}
function dividasDo(t: Tipo): SfDivida[] { return D.dividas.filter((d) => d.grupo === t); }
function statsTipo(t: Tipo): Stats { return stats(dividasDo(t).filter(contaNaDivida)); }
function statsTotal(): Stats { return stats(D.dividas.filter((d) => (TIPOS as string[]).includes(d.grupo) && contaNaDivida(d))); }

/** k = margem de contribuição − imposto sobre o faturamento (de cada R$ 1 faturado, quanto sobra). */
function fatorK(): number | null {
  const m = num(D.painel.meta?.margem) ?? 0.4405;
  const t = num(D.painel.meta?.tributo) ?? 0.1333;
  const k = m - t;
  return k > 0 ? k : null;
}
function custoFixo(): number { return num(D.painel.despesas_fixas?.total_mensal) ?? num(D.painel.meta?.fixo_mensal) ?? 27920; }
/** Faturamento a mais por mês para zerar o tipo no prazo dele. */
function extraMesTipo(t: Tipo): number | null {
  const k = fatorK();
  return k ? statsTipo(t).realistaAberto / prazoDe(t) / k : null;
}
function metaReceita(): { k: number; fixo: number; manter: number; quitar: number } | null {
  const k = fatorK();
  if (!k) return null;
  const fixo = custoFixo();
  const parcelas = TIPOS.reduce((s, t) => s + statsTipo(t).realistaAberto / prazoDe(t), 0);
  return { k, fixo, manter: fixo / k, quitar: (fixo + parcelas) / k };
}

// ───────────────────────── receita ao vivo ─────────────────────────
function fluxoFechado(): FluxoMes[] {
  if (!vivo) return [];
  // fechado = antes do mês de HOJE e antes do mês da LEITURA (cópia velha da Vobi traz o mês dela pela metade)
  const hoje = hojeISO().slice(0, 7);
  const lido = mesSP(vivo.atualizadoEm);
  const atual = lido && lido < hoje ? lido : hoje;
  return arr<FluxoMes>(vivo.fluxo).filter((m) => m && typeof m.mes === "string" && m.mes < atual)
    .sort((a, b) => a.mes.localeCompare(b.mes));
}
function mediaReceita(n: number): { valor: number; de: string; ate: string } | null {
  const f = fluxoFechado().slice(-n);
  if (!f.length) return null;
  const v = f.reduce((s, m) => s + n0(m.receita), 0) / f.length;
  return { valor: v, de: f[0].mes, ate: f[f.length - 1].mes };
}
function fornecedoresVobi(): { total: number; vencido: number; aVencer: number } | null {
  const ab = vivo?.aberto;
  if (!ab) return null;
  const r = { total: 0, vencido: 0, aVencer: 0 };
  for (const g of ab.porGrupo) {
    if (g.aba !== "fornecedor" || g.grupo === "fornecedor_contingente") continue; // Tax All fica fora (contingente)
    r.total += n0(g.total); r.vencido += n0(g.vencido); r.aVencer += n0(g.aVencer);
  }
  return r;
}
function somaDias(iso: string, dias: number): string {
  const [a, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d + dias));
  return dt.toISOString().slice(0, 10);
}
/** Quanto do comprometido de uma linha vence nos próximos 30 dias; null = sem data para saber.
 *  1º a Vobi (linha ligada a um fornecedor: soma exata das parcelas dos próximos 30 dias);
 *  senão o próximo vencimento da linha, contando a parcela mensal (ou o a vencer inteiro, se não houver parcela). */
function aVencer30(d: SfDivida): number | null {
  const av = aVencer(d);
  if (!(av > 0)) return 0;
  const id = num(d.vobi_fornecedor_id);
  if (id != null && vivo?.aberto) {
    const pf = /pessoa f[ií]sica|fora da empresa/i.test(txt(d.subgrupo));
    let s = 0, achou = false;
    for (const x of arr<{ idFornecedor: number | null; grupo: string; aVencer30?: number }>(vivo.aberto.porFornecedor)) {
      if (x.idFornecedor !== id || (x.grupo === "pessoa_fisica" && !pf)) continue;
      achou = true;
      s += n0(x.aVencer30);
    }
    if (achou) return Math.min(s, av);
  }
  const pv = divisao(d).proximo; // já avançado quando a data gravada passou (o que venceu foi para o vencido)
  if (!pv) return null;
  if (pv > somaDias(hojeISO(), 30)) return 0;
  const parc = num(d.parcela_mensal);
  return parc != null && parc > 0 ? Math.min(parc, av) : av;
}

// ───────────────────────── A reaver ─────────────────────────
function reaverAberto(): SfReaver[] { return D.reaver.filter((r) => r.ativo !== false && !r.recebido); }
function reaverRecebido(): SfReaver[] { return D.reaver.filter((r) => r.ativo !== false && r.recebido); }
function textoReaver(r: SfReaver): string { return [r.titulo, r.contraparte, r.situacao, r.observacao].map(txt).join(" "); }
/** Item no CPF da sócia: a devolução vai para a pessoa física — fora da conta da empresa. */
function reaverNoCpf(r: SfReaver): boolean {
  return /\bno CPF\b|para o CPF|\bCPF d[ao] (Adriana|s[oó]ci[ao])/i.test([r.titulo, r.observacao].map(txt).join(" "));
}
/** Não vira dinheiro no caixa: créditos tributários e compensações (abatem uma dívida). */
function reaverAbateDivida(r: SfReaver): boolean {
  return r.tipo === "credito_tributario" || /n[ãa]o (deve )?vira(r)? dinheiro|\babate\b|\bcompensar com\b/i.test(textoReaver(r));
}
function somaReaver(): { pode: number; provavel: number; voltou: number; credito: number; cpf: number } {
  let pode = 0, provavel = 0, voltou = 0, credito = 0, cpf = 0;
  for (const r of reaverAberto()) {
    const v = n0(r.valor_estimado);
    if (reaverNoCpf(r)) { cpf += v; continue; } // fora do "pode voltar" e do "provável" da empresa
    pode += v;
    if (r.chance === "alta" || r.chance === "media") provavel += v;
    if (reaverAbateDivida(r)) credito += v;
  }
  for (const r of reaverRecebido()) voltou += num(r.valor_recebido) ?? n0(r.valor_estimado);
  return { pode, provavel, voltou, credito, cpf };
}

// ───────────────────────── plano v2 ─────────────────────────
function acaoPorId(id: string): SfAcao | undefined { return D.acoes.find((a) => a.id === id); }
function vendidoPlano(): number { return D.acoes.reduce((s, a) => s + n0(a.valor_vendido), 0); }
function emAndamento(): number { return D.acoes.filter((a) => a.status === "testando" || a.status === "em_andamento").length; }

// ───────────────────────── selos ─────────────────────────
const SITUACOES: Record<string, [string, string]> = {
  inscrita: ["Dívida ativa", "orange"],
  intimada: ["Intimada", "yellow"],
  protestada: ["Protestada", "red"],
  ajuizada: ["Ajuizada", "red"],
  execucao: ["Em execução", "red"],
  citada: ["Citada", "red"],
  atrasada: ["Atrasada", "orange"],
  em_dia: ["Em dia", "green"],
  acordo: ["Em acordo", "blue"],
  negociacao: ["Em negociação", "purple"],
};
function badgeSituacao(s: unknown): string {
  const t = txt(s).trim();
  if (!t) return "";
  const c = SITUACOES[chaveSituacao(t)];
  return c ? `<span class="badge badge-${c[1]}">${esc(c[0])}</span>` : `<span class="badge badge-gray">${esc(t)}</span>`;
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

// ───────────────────────── aviso flutuante ─────────────────────────
let toastTimer = 0;
function toast(msg: string, tipo: "ok" | "erro" = "ok"): void {
  let t = el("sfToast");
  if (!t) {
    t = document.createElement("div");
    t.id = "sfToast";
    t.setAttribute("role", "status");
    t.setAttribute("aria-live", "polite");
    document.body.appendChild(t);
  }
  t.className = `sf-toast sf-toast-${tipo}`;
  t.innerHTML = `<span class="sf-toast-ic">${tipo === "ok" ? "✓" : "!"}</span><span>${esc(msg)}</span>`;
  void t.offsetWidth; // reinicia a animação
  t.classList.add("sf-toast-on");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t?.classList.remove("sf-toast-on"), tipo === "ok" ? 3200 : 5000);
}

// ───────────────────────── 1. Painel ─────────────────────────
function renderPainel(): void {
  const sec = el("sfSecPainel");
  if (!sec) return;
  if (!D.dividas.length) {
    sec.innerHTML = `<div class="empty-state"><strong>Nenhuma dívida cadastrada.</strong>${D.faltaMigration ? "As tabelas ainda não foram criadas." : ""}</div>`;
    return;
  }
  const st = statsTotal();
  // só o VENCIDO é dívida em aberto: linha só "a vencer" não entra no herói nem nas próximas vitórias
  const abertas = D.dividas.filter((d) => (TIPOS as string[]).includes(d.grupo) && contaNaDivida(d) && emAberto(d));

  // (1) herói: o que já foi eliminado
  let frase: string;
  if (!st.qtdQuitadas) {
    const menor = abertas.filter((d) => realista(d) > 0).sort((a, b) => realista(a) - realista(b))[0];
    frase = menor ? `A primeira vitória está na lista abaixo — a menor custa ${esc(fmtR(realista(menor)))}.` : "Marque aqui cada dívida que você quitar.";
  } else {
    const ultima = D.dividas.filter((d) => d.quitada && d.quitada_em).sort((a, b) => txt(b.quitada_em).localeCompare(txt(a.quitada_em)))[0];
    const quando = ultima ? `${esc(ultima.credor)}${ultima.quitada_em ? ` em ${esc(fmtDataCurta(ultima.quitada_em))}` : ""}` : "";
    frase = st.qtdQuitadas === 1
      ? `Primeira vitória${quando ? `: ${quando}` : ""}. Siga para a próxima!`
      : `${st.qtdQuitadas} dívidas fora da lista${quando ? ` — a última foi ${quando}` : ""}. Siga para a próxima!`;
  }
  const heroi = `<div class="sf-hero">
    <div class="sf-hero-top">
      <div><div class="sf-hero-l">Você já eliminou</div><div class="sf-hero-v">${esc(fmtR(st.eliminado))}</div></div>
      <div class="sf-hero-cont"><strong>${st.qtdQuitadas}</strong> de ${st.qtdTotal} dívidas quitadas</div>
    </div>
    <div class="sf-prog" title="${esc(fmtPct(st.progresso))} do total"><div class="sf-prog-bar" style="width:${pctBarra(st.progresso)}%"></div></div>
    <p class="sf-hero-frase">${frase}</p>
  </div>`;

  // (2) quatro números
  const rv = somaReaver();
  const m3 = mediaReceita(3);
  const receitaSub = m3 ? `média de ${esc(faixaMeses(m3.de, m3.ate))} (Vobi)` : (aguardandoVivo() ? "buscando na Vobi…" : "sem leitura da Vobi");
  const cards = `<div class="sf-cards">
    <div class="sf-c"><div class="sf-c-l">Dívida hoje (vencida)</div><div class="sf-c-v">${esc(fmtCurto(st.devidoAberto))}</div><div class="sf-c-s">${st.qtdAbertas} vencida${st.qtdAbertas === 1 ? "" : "s"}${st.comCobranca > 0 ? ` · ${esc(fmtCurto(st.comCobranca))} com cobrança` : ""}${st.semValor > 0 ? ` · ${st.semValor} sem valor` : ""}</div></div>
    <div class="sf-c sf-c-azul"><div class="sf-c-l">Realista</div><div class="sf-c-v">${esc(fmtCurto(st.realistaAberto))}</div><div class="sf-c-s">${st.economia > 0 ? `−${esc(fmtCurto(st.economia))} negociados` : "com as propostas que entrarem"}</div></div>
    <div class="sf-c sf-c-verde"><div class="sf-c-l">A reaver</div><div class="sf-c-v">${esc(fmtCurto(rv.pode))}</div><div class="sf-c-s">provável ${esc(fmtCurto(rv.provavel))}${rv.credito > 0 ? ` · ${esc(fmtCurto(rv.credito))} abatem dívida` : ""}</div></div>
    <div class="sf-c"><div class="sf-c-l">Receita média/mês</div><div class="sf-c-v">${m3 ? esc(fmtCurto(m3.valor)) : "—"}</div><div class="sf-c-s">${receitaSub}</div></div>
  </div>`;

  sec.innerHTML = `${heroi}${cards}${blocoComprometidoPainel(st)}${blocoMeta(m3)}
    <div class="sf-blk">${blkTitulo("layout-list", "Por tipo")}<div class="sf-tipos">${TIPOS.map(linhaTipoPainel).join("")}</div></div>
    ${blocoVitorias(abertas)}
    ${blocoConquistas()}`;
}
/** Card "Comprometido (a vencer)": parcelas futuras, FORA da dívida e da meta (boa parte já está no custo fixo). */
function blocoComprometidoPainel(st: Stats): string {
  const ls = D.dividas.filter((d) => (TIPOS as string[]).includes(d.grupo) && contaNaDivida(d) && comprometida(d));
  if (!ls.length && !(st.cortado > 0)) return "";
  let p30 = 0, semData = 0;
  for (const d of ls) {
    const v = aVencer30(d);
    if (v == null) semData++;
    else p30 += v;
  }
  const porTipo = TIPOS.map((t) => [TIPO_INFO[t].nome, ls.filter((d) => d.grupo === t).reduce((s, d) => s + aVencer(d), 0)] as const)
    .filter(([, v]) => v > 0).map(([n, v]) => `${esc(n)} ${esc(fmtCurto(v))}`).join(" · ");
  return `<div class="sf-comp" title="Parcelas que ainda vão vencer: não são dívida e não entram na meta. Veja e corte o que não vai acontecer no fim de cada aba.">
    <div class="sf-comp-h"><span class="sf-c-l">Comprometido (a vencer)</span><span class="sf-comp-v">${esc(fmtCurto(st.aVencer))}</span></div>
    <div class="sf-comp-s">próximos 30 dias: <strong>${esc(fmtR(p30))}</strong>${semData ? ` · ${semData} sem data` : ""} · fora da dívida e da meta${st.cortado > 0 ? ` · <span class="sf-pos">você cortou ${esc(fmtCurto(st.cortado))}</span>` : ""}</div>
    ${porTipo ? `<div class="sf-comp-t">${porTipo}</div>` : ""}
  </div>`;
}
function blkTitulo(icone: string, titulo: string): string {
  return `<p class="sf-blk-title"><i class="ti ti-${icone}" aria-hidden="true"></i> ${esc(titulo)}</p>`;
}
function blocoMeta(m3: { valor: number; de: string; ate: string } | null): string {
  const mr = metaReceita();
  if (!mr) return `<div class="card sf-meta"><div class="sf-card-t">Meta de receita</div><p class="sf-muted">Faltam a margem e o imposto do painel para fazer a conta.</p></div>`;
  const a = m3 ? m3.valor : null;
  const opts = PRAZOS.map((p) => `<option value="${p}"${p === prazo ? " selected" : ""}>${p}</option>`).join("");
  const max = Math.max(mr.quitar, a ?? 0, 1);
  const pos = (v: number) => Math.min(100, Math.max(0, (v / max) * 100)).toFixed(2);
  const falta = a != null ? mr.quitar - a : null;
  const trilho = a != null ? `<div class="sf-trilho" aria-hidden="true">
      <div class="sf-trilho-fill" style="width:${pos(a)}%;background:${a >= mr.manter ? "var(--success)" : "var(--info)"}"></div>
      <span class="sf-trilho-marca" style="left:${pos(mr.manter)}%" title="Para manter a empresa: ${esc(fmtR(mr.manter))}"></span>
    </div>
    <div class="sf-trilho-leg"><span>Hoje ${esc(fmtCurto(a))}</span><span>▮ manter ${esc(fmtCurto(mr.manter))}</span><span>${falta != null && falta > 0 ? `faltam ${esc(fmtCurto(falta))}/mês` : "meta alcançada"}</span></div>`
    : `<p class="sf-muted" style="margin-top:8px">${aguardandoVivo() ? "Buscando a receita na Vobi…" : "Sem a leitura da Vobi, não dá para comparar com a receita real."}</p>`;
  const alavanca = 100000 / prazo / mr.k;
  return `<div class="card sf-meta">
    <div class="sf-card-t">Meta de receita</div>
    <div class="sf-meta-l"><span>Você fatura</span><strong>${a != null ? esc(fmtR(a)) + "/mês" : "—"}</strong></div>
    <div class="sf-meta-l"><span>Para manter a empresa</span><strong>${esc(fmtR(mr.manter))}/mês</strong></div>
    <div class="sf-meta-l"><span>Para quitar em <select data-sf-prazo aria-label="Prazo em meses">${opts}</select> meses</span><strong>${esc(fmtR(mr.quitar))}/mês</strong></div>
    <div class="sf-meta-nota">Impostos sempre em ${PRAZO_IMPOSTO} meses (parcelamento da PGFN; acordo vedado até 18/12/2027).</div>
    ${trilho}
    <p class="sf-alavanca">Cada R$ 100 mil negociados a menos = −${esc(fmtR(alavanca))}/mês na meta.</p>
    ${detalhes("painel|calc", false, "", "Como calculei", `<div class="sf-det-body"><ul>
      <li>Dívida = só o que já VENCEU e não foi pago (com ou sem cobrança); o que vence depois é “comprometido” e fica fora da dívida e da meta (boa parte já está no custo fixo).</li>
      <li>Parcela comprometida cuja data passou sem atualização entra sozinha no vencido (selo “venceu — atualize”); nos bancos, o saldo inteiro só conta como vencido quando ele foi antecipado (execução, protesto).</li>
      <li>De cada R$ 100 faturados sobram ${esc(fmtR(mr.k * 100))}: margem de ${esc(FMT_N.format(n0(D.painel.meta?.margem ?? 0.4405) * 100))}% menos ${esc(FMT_N.format(n0(D.painel.meta?.tributo ?? 0.1333) * 100))}% de imposto.</li>
      <li>Manter a empresa = custo fixo ${esc(fmtR(mr.fixo))} ÷ ${esc(mr.k.toLocaleString("pt-BR", { maximumFractionDigits: 4 }))}.</li>
      <li>Quitar = (custo fixo + impostos ÷ ${PRAZO_IMPOSTO} + bancos, fornecedores e outras ÷ ${prazo}) ÷ ${esc(mr.k.toLocaleString("pt-BR", { maximumFractionDigits: 4 }))}.</li>
      <li>Usa o valor realista: a proposta de quitação quando houver; senão, o devido. Sem juros.</li>
      <li>Receita = média da receita das obras e serviços nos 3 últimos meses fechados (Vobi).</li>
      <li>Dívida sem valor de hoje conta R$ 0 até você informar (o máximo do levantamento só aparece de referência).</li>
      <li>Fora da conta: pessoa física, sócios (último da fila), “a conferir” e o contingente.</li>
    </ul></div>`)}
  </div>`;
}
function linhaTipoPainel(t: Tipo): string {
  const i = TIPO_INFO[t];
  const s = statsTipo(t);
  const extra = extraMesTipo(t);
  return `<button type="button" class="sf-tipo" style="--c:${i.cor}" data-sf-act="ir-aba" data-aba="${i.aba}">
    <span class="sf-tipo-ic"><i class="ti ti-${i.ic}" aria-hidden="true"></i></span>
    <span class="sf-tipo-main">
      <span class="sf-tipo-top"><strong>${esc(i.nome)}</strong><span class="sf-tipo-v">${esc(fmtCurto(s.realistaAberto))}</span></span>
      <span class="sf-mini" title="${esc(fmtPct(s.progresso))} eliminado"><span style="width:${pctBarra(s.progresso)}%"></span></span>
      <span class="sf-tipo-sub">${s.qtdQuitadas}/${s.qtdTotal} quitadas${extra != null && extra > 0 ? ` · +${esc(fmtCurto(extra))}/mês p/ zerar em ${prazoDe(t)} meses` : ""}</span>
    </span>
  </button>`;
}
function blocoVitorias(abertas: SfDivida[]): string {
  const l = abertas.filter((d) => realista(d) > 0).sort((a, b) => realista(a) - realista(b)).slice(0, 3);
  if (!l.length) return "";
  const k = fatorK();
  return `<div class="sf-blk">${blkTitulo("target-arrow", "Próximas vitórias")}<div class="sf-vits">${l.map((d) => `
    <div class="sf-vit">
      <div class="sf-vit-info"><strong>${esc(d.credor)}</strong><span class="sf-muted sf-vit-id"${d.identificacao ? ` title="${esc(d.identificacao)}"` : ""}>${esc(TIPO_INFO[d.grupo as Tipo]?.nome || d.grupo)}${d.identificacao ? " · " + esc(d.identificacao) : ""}</span>
        ${k ? `<div class="sf-small">equivale a ${esc(fmtR(realista(d) / k))} de faturamento</div>` : ""}</div>
      <span class="sf-vit-v">${esc(fmtR(realista(d)))}</span>
      ${botaoQuitei(d)}
    </div>`).join("")}</div></div>`;
}
function blocoConquistas(): string {
  type Conq = { data: string; txt: string };
  const c: Conq[] = [];
  for (const d of D.dividas) if (d.quitada) c.push({ data: txt(d.quitada_em), txt: `Quitou ${d.credor} — ${fmtR(pagoDe(d))}` });
  for (const d of D.dividas) {
    if (d.ativo !== false && pagoParcial(d) > 0) c.push({ data: txt(d.quitada_em), txt: `Pagou o vencido de ${d.credor} — ${fmtR(pagoParcial(d))}` });
  }
  for (const r of D.reaver) if (r.ativo !== false && r.recebido) c.push({ data: txt(r.recebido_em), txt: `Recebeu: ${r.titulo} — ${fmtR(num(r.valor_recebido) ?? r.valor_estimado)}` });
  // venda do plano não tem data própria (updated_at muda a cada edição da ideia): entra sem data, depois das datadas
  for (const a of D.acoes) if (n0(a.valor_vendido) > 0) c.push({ data: "", txt: `Vendeu ${fmtR(a.valor_vendido)} com “${a.titulo}”` });
  for (const p of D.protestos) if (p.cancelado) c.push({ data: txt(p.cancelado_em), txt: `Cancelou o protesto de ${p.credor}` });
  for (const d of D.dividas) {
    if (d.ativo !== false && d.comprometida_cortada && !d.quitada && aVencer(d) > 0) {
      c.push({ data: txt(d.cortada_em), txt: `Cortou despesa comprometida — ${fmtR(aVencer(d))} (${d.credor})` });
    }
  }
  if (!c.length) return "";
  c.sort((a, b) => (a.data ? 0 : 1) - (b.data ? 0 : 1) || b.data.localeCompare(a.data));
  return `<div class="sf-blk">${blkTitulo("trophy", "Conquistas")}<ul class="sf-conq">${c.slice(0, 6).map((x) =>
    `<li><span class="sf-conq-ic">✓</span><span class="sf-conq-txt">${esc(x.txt)}</span><span class="sf-conq-dt">${esc(fmtDataCurta(x.data))}</span></li>`).join("")}</ul></div>`;
}

// ───────────────────────── 2–5. Abas de tipo ─────────────────────────
// Cada aba: "Vencidas — com cobrança", "Vencidas — sem cobrança" (só linhas com algo VENCIDO), quitadas, fora da conta
// e, recolhido no fim, "Despesas comprometidas — a vencer" (não entram na dívida; dá para cortar o que não vai acontecer).
function cabecalhoTipo(t: Tipo): string {
  const i = TIPO_INFO[t];
  const s = statsTipo(t);
  const extra = extraMesTipo(t);
  return `<div class="sf-thead" style="--c:${i.cor}">
    <div class="sf-thead-nums">
      <div><span>Vencido em aberto</span><strong>${esc(fmtCurto(s.devidoAberto))}</strong>${s.semValor > 0 ? `<em class="sf-em-cinza">${s.semValor} sem valor de hoje — informe no ✎</em>` : ""}</div>
      <div><span>Realista</span><strong>${esc(fmtCurto(s.realistaAberto))}</strong>${s.economia > 0 ? `<em>−${esc(fmtCurto(s.economia))} negociados</em>` : ""}</div>
      <div><span>Quitadas</span><strong>${s.qtdQuitadas}/${s.qtdTotal}</strong></div>
      <div><span>Zerar em ${prazoDe(t)} meses</span><strong>${extra != null ? `+${esc(fmtCurto(extra))}/mês` : "—"}</strong></div>
    </div>
    <div class="sf-prog" title="${esc(fmtPct(s.progresso))} eliminado"><div class="sf-prog-bar" style="width:${pctBarra(s.progresso)}%"></div></div>
  </div>`;
}
function renderCabecalhoTipo(t: Tipo): void {
  const h = el(`sfHead-${t}`);
  if (h) h.innerHTML = cabecalhoTipo(t);
}
function linhaVobiFornecedores(): string {
  const f = fornecedoresVobi();
  if (f) return `Na Vobi hoje, com fornecedores: <strong>${esc(fmtR(f.vencido))}</strong> vencido · ${esc(fmtR(f.aVencer))} a vencer (comprometido, fora da dívida).`;
  if (aguardandoVivo()) return "Buscando os fornecedores em aberto na Vobi…";
  return "Sem a leitura da Vobi agora.";
}
function extraTipo(t: Tipo): string {
  if (t === "imposto") {
    const ret = dividasDo("imposto").filter((d) => d.retido && contaNaDivida(d) && emAberto(d));
    if (!ret.length) return "";
    const v = ret.reduce((s, d) => s + devido(d), 0);
    return `<div class="sf-alerta">🔴 ${ret.length} imposto(s) retido(s) vencido(s): ${esc(fmtR(v))} — risco penal; pagar primeiro.</div>`;
  }
  if (t === "fornecedor") return `<div class="sf-ref" id="sfVobiForn">${linhaVobiFornecedores()}</div>`;
  return "";
}
function selosDivida(d: SfDivida): string {
  const s: string[] = [];
  if (d.retido) s.push(`<span class="badge badge-red" title="Imposto descontado de terceiros e não repassado">🔴 retido</span>`);
  const sit = badgeSituacao(d.situacao);
  if (sit) s.push(sit);
  if (semValor(d)) s.push(`<span class="badge badge-gray">sem valor</span>`);
  s.push(seloVenceu(d));
  const h = s.filter(Boolean);
  return h.length ? `<div class="sf-l-selos">${h.join("")}</div>` : "";
}
/** O próximo vencimento gravado já passou: a tela tratou o que venceu como vencido (estimativa) — atualize. */
function seloVenceu(d: SfDivida): string {
  const dv = divisao(d);
  if (!(dv.estimado > 0) || !dv.venceuEm) return "";
  const como = num(d.parcela_mensal) ? "pela parcela por mês" : "todo o a vencer";
  return `<span class="badge badge-orange" title="O próximo vencimento gravado (${esc(fmtData(dv.venceuEm))}) já passou: a tela passou ${esc(fmtR(dv.estimado))} para o vencido (${como}). Confira no ✎ ou pela Vobi.">venceu em ${esc(fmtDataCurta(dv.venceuEm))} — atualize</span>`;
}
/** "já pagou R$ X do vencido" (linha que segue aberta por causa do a vencer), com o desfazer. */
function notaPagoParcial(d: SfDivida): string {
  const pp = pagoParcial(d);
  if (!(pp > 0)) return "";
  const quando = d.quitada_em ? ` em ${esc(fmtDataCurta(d.quitada_em))}` : "";
  const desf = D.podeEditar ? ` <button type="button" class="sf-link" data-requer-edicao data-sf-act="desfazer-parcial" data-id="${esc(d.id)}">desfazer</button>` : "";
  return `<div class="sf-l-motivo sf-l-pago">✓ já pagou ${esc(fmtR(pp))} do vencido${quando}${desf}</div>`;
}
function textoEconomia(d: SfDivida): string {
  const p = num(d.valor_proposta);
  const dv = devido(d);
  if (p == null) return "";
  if (p < dv) return `−${fmtR(dv - p)}`;
  if (p > dv && dv > 0) return `+${fmtR(p - dv)} acima do vencido`;
  return "";
}
/** Célula "Vencido" (é a dívida); o que ainda vai vencer aparece embaixo, cinza, só de referência. */
function celDevido(d: SfDivida): string {
  const t = num(d.valor_teto);
  const av = aVencer(d);
  let h: string;
  if (semValor(d)) {
    h = t == null ? `<strong class="sf-muted">—</strong>` : `<strong class="sf-muted">—</strong><span class="sf-muted">sem valor de hoje · máx. ${esc(fmtR(t))}</span>`;
  } else {
    const v = vencido(d);
    h = `<strong>${esc(fmtR(v))}</strong>${t != null && t !== v && !emDiaSemSeparar(d) ? `<span class="sf-muted">até ${esc(fmtR(t))}</span>` : ""}`;
  }
  if (av > 0) h += `<span class="sf-muted">+ ${esc(fmtR(av))} a vencer${d.comprometida_cortada ? " (cortado)" : ""}</span>`;
  return `<div class="sf-l-devido"><span class="sf-l-rot">Vencido</span>${h}</div>`;
}
/** Identificação em 1 linha (cortada com "…"); o texto inteiro fica no title e no ✎. */
function idDivida(d: SfDivida): string {
  return d.identificacao ? `<div class="sf-l-id" title="${esc(d.identificacao)}">${esc(d.identificacao)}</div>` : "";
}
/** Botão "✓ Quitei": numa linha com a vencer, paga SÓ o vencido (o a vencer continua comprometido). */
function botaoQuitei(d: SfDivida): string {
  if (!D.podeEditar) return "";
  const dica = aVencer(d) > 0 ? ` title="Paga só o vencido; o que ainda vai vencer continua como despesa comprometida"` : "";
  return `<button type="button" class="sf-quitei" data-requer-edicao data-sf-act="quitar" data-id="${esc(d.id)}"${dica}>✓ Quitei</button>`;
}
function linhaAberta(d: SfDivida): string {
  const dis = D.podeEditar ? "" : " disabled";
  return `<div class="sf-linha" data-linha-id="${esc(d.id)}">
    <div class="sf-l-info"><div class="sf-l-cred">${esc(d.credor)}</div>${idDivida(d)}${selosDivida(d)}${notaPagoParcial(d)}</div>
    ${celDevido(d)}
    <div class="sf-l-prop"><label class="sf-l-rot" for="sfp-${esc(d.id)}">Proposta de quitação</label>
      <input id="sfp-${esc(d.id)}" class="sf-in" type="text" inputmode="decimal" placeholder="R$ para quitar" data-prop-id="${esc(d.id)}" value="${esc(valorParaCampo(d.valor_proposta))}"${dis} />
      <span class="sf-econ" data-econ-id="${esc(d.id)}">${esc(textoEconomia(d))}</span></div>
    <div class="sf-l-acoes">
      ${botaoQuitei(d)}
      <button type="button" class="sf-ed" title="Detalhes" aria-label="Detalhes de ${esc(d.credor)}" data-sf-act="editar-divida" data-id="${esc(d.id)}">✎</button>
    </div>
  </div>`;
}
/** Total do subgrupo no resumo recolhível: vencido e, quando há proposta, "→ realista". */
function totSubgrupo(ds: SfDivida[]): string {
  const devidoSub = ds.reduce((s, d) => s + devido(d), 0);
  const realSub = ds.reduce((s, d) => s + realista(d), 0);
  return `${esc(fmtCurto(devidoSub))}${Math.abs(realSub - devidoSub) > 0.5 ? ` → ${esc(fmtCurto(realSub))}` : ""}`;
}
function detalhes(chave: string, padraoAberto: boolean, cls: string, resumo: string, corpo: string): string {
  const aberto = detAberto.has(chave) ? detAberto.get(chave) : padraoAberto;
  return `<details class="sf-det ${cls}" data-det="${esc(chave)}"${aberto ? " open" : ""}><summary>${resumo}</summary>${corpo}</details>`;
}
function subgrupoDe(d: SfDivida): string { return txt(d.subgrupo).trim() || "Outros"; }
/** Linhas que entram num bloco de vencidas (mesma regra da tela e da atualização do total ao digitar a proposta). */
function vencidasDo(t: Tipo, cob: Cobranca): SfDivida[] {
  return dividasDo(t).filter((d) => contaNaDivida(d) && emAberto(d) && cobrancaDe(d) === cob);
}
const BLOCO_VENC: Record<Cobranca, { titulo: string; dica: string; ic: string; cls: string }> = {
  com_cobranca: { titulo: "Vencidas — com cobrança", dica: "protesto, intimação, execução/ação, cobrança jurídica ou dívida ativa", ic: "gavel", cls: "sf-bloco-com" },
  sem_cobranca: { titulo: "Vencidas — sem cobrança", dica: "atrasadas, sem protesto nem ação conhecidos", ic: "clock-exclamation", cls: "sf-bloco-sem" },
};
function blocoVencidas(t: Tipo, cob: Cobranca): string {
  const ds = vencidasDo(t, cob);
  if (!ds.length) return "";
  const b = BLOCO_VENC[cob];
  // agrupadas por subgrupo (Bancos: por banco), na ordem do levantamento
  const grupos = new Map<string, SfDivida[]>();
  for (const d of ds) {
    const k = subgrupoDe(d);
    grupos.set(k, [...(grupos.get(k) || []), d]);
  }
  let lista = "";
  for (const [sub, l] of grupos) {
    const resumo = `${esc(sub)} <span class="sf-muted">(${l.length})</span><span class="sf-grupo-tot">${totSubgrupo(l)}</span>`;
    lista += detalhes(`${t}|${cob}|${sub}`, l.length <= 8, "sf-grupo", resumo, l.map(linhaAberta).join(""));
  }
  return `<div class="sf-bloco ${b.cls}">
    <div class="sf-bloco-t"><span><i class="ti ti-${b.ic}" aria-hidden="true"></i> ${esc(b.titulo)} <span class="sf-bloco-n">(${ds.length})</span></span><span class="sf-bloco-tot">${totSubgrupo(ds)}</span><span class="sf-bloco-sub">${esc(b.dica)}</span></div>
    ${lista}
  </div>`;
}
/** Despesa comprometida (a vencer): não é dívida; o botão "✗ Não vai acontecer" corta (fica riscada, dá para desfazer). */
function linhaComprometida(d: SfDivida): string {
  const cort = d.comprometida_cortada === true;
  const dv = divisao(d);
  const botao = !D.podeEditar ? ""
    : cort
      ? `<button type="button" class="sf-ed" data-requer-edicao data-sf-act="descortar-comp" data-id="${esc(d.id)}">desfazer</button>`
      : `<button type="button" class="sf-cortar" data-requer-edicao data-sf-act="cortar-comp" data-id="${esc(d.id)}" title="Esta despesa não vai acontecer: sai do comprometido">✗ Não vai acontecer</button>`;
  const semData = !cort && !dv.proximo
    ? `<div class="sf-l-selos"><span class="badge badge-gray" title="Sem a data a tela não sabe quando o comprometido vira vencido">informe o vencimento no ✎</span></div>`
    : "";
  const vencNota = dv.vencido > 0
    ? `<div class="sf-l-motivo">também tem ${esc(fmtR(dv.vencido))} vencido (na lista acima)</div>`
    : dv.semValor ? `<div class="sf-l-motivo">vencido sem valor de hoje (na lista acima)</div>` : "";
  return `<div class="sf-linha sf-linha-comp${cort ? " sf-linha-cortada" : ""}">
    <div class="sf-l-info"><div class="sf-l-cred">${esc(d.credor)}</div>${idDivida(d)}
      ${cort ? `<div class="sf-l-motivo">✗ cortada${d.cortada_em ? ` em ${esc(fmtDataCurta(d.cortada_em))}` : ""} — não vai acontecer</div>` : ""}
      ${vencNota}${notaPagoParcial(d)}${semData}</div>
    <div class="sf-l-devido"><span class="sf-l-rot">A vencer</span><strong>${esc(fmtR(dv.aVencer))}</strong></div>
    <div class="sf-l-devido"><span class="sf-l-rot">Próximo venc.</span><strong${dv.proximo ? "" : ` class="sf-muted"`}>${dv.proximo ? esc(fmtData(dv.proximo)) : "—"}</strong></div>
    <div class="sf-l-acoes">${botao}<button type="button" class="sf-ed" aria-label="Detalhes de ${esc(d.credor)}" data-sf-act="editar-divida" data-id="${esc(d.id)}">✎</button></div>
  </div>`;
}
function blocoComprometidas(t: Tipo, dentro: SfDivida[]): string {
  const ls = dentro.filter((d) => !d.quitada && aVencer(d) > 0);
  if (!ls.length) return "";
  const pv = (d: SfDivida) => divisao(d).proximo || "9999-12-31";
  const ativas = ls.filter((d) => !d.comprometida_cortada).sort((a, b) => pv(a).localeCompare(pv(b)) || aVencer(b) - aVencer(a));
  const cortadas = ls.filter((d) => d.comprometida_cortada);
  const soma = ativas.reduce((s, d) => s + aVencer(d), 0);
  const corte = cortadas.reduce((s, d) => s + aVencer(d), 0);
  const resumo = `Despesas comprometidas — a vencer <span class="sf-muted">(${ativas.length}) · não entram na dívida</span><span class="sf-grupo-tot">${esc(fmtCurto(soma))}${corte > 0 ? ` <span class="sf-pos">· cortou ${esc(fmtCurto(corte))}</span>` : ""}</span>`;
  return detalhes(`${t}|comprometidas`, false, "sf-comp-det", resumo, [...ativas, ...cortadas].map(linhaComprometida).join(""));
}
function renderTipo(t: Tipo): void {
  const i = TIPO_INFO[t];
  const sec = el(i.sec);
  if (!sec) return;
  const todas = dividasDo(t);
  if (!todas.length) {
    sec.innerHTML = `<div class="empty-state"><strong>Nada cadastrado em ${esc(i.nome)}.</strong>${D.faltaMigration ? "As tabelas ainda não foram criadas." : ""}</div>`;
    return;
  }
  const dentro = todas.filter(contaNaDivida);
  const abertas = dentro.filter(emAberto);
  const quitadas = dentro.filter((d) => d.quitada);
  // sem nada vencido nem a vencer e não quitada (ex.: a Vobi zerou uma linha sem valor): não pode sumir da tela
  const semSaldo = dentro.filter((d) => !d.quitada && !emAberto(d) && !(aVencer(d) > 0));
  const fora = todas.filter((d) => !contaNaDivida(d));

  let lista = `${blocoVencidas(t, "com_cobranca")}${blocoVencidas(t, "sem_cobranca")}`;
  if (!abertas.length) lista = `<div class="sf-box sf-box-verde"><strong>Nada vencido aqui.</strong>Nenhuma dívida vencida em aberto em ${esc(i.nome)}.</div>`;

  const blocoQuit = quitadas.length ? detalhes(`${t}|quitadas`, false, "sf-quitadas", `✓ Quitadas (${quitadas.length}) <span class="sf-grupo-tot">${esc(fmtCurto(quitadas.reduce((s, d) => s + eliminadoDe(d), 0)))} eliminados</span>`,
    quitadas.map((d) => `<div class="sf-linha sf-linha-ok">
      <div class="sf-l-info"><div class="sf-l-cred">${esc(d.credor)}</div>${idDivida(d)}</div>
      <span class="sf-small">pago ${esc(fmtR(pagoDe(d)))}${d.quitada_em ? ` em ${esc(fmtData(d.quitada_em))}` : ""}</span>
      <div class="sf-l-acoes">${D.podeEditar ? `<button type="button" class="sf-ed" data-requer-edicao data-sf-act="desfazer-quitar" data-id="${esc(d.id)}">desfazer</button>` : ""}<button type="button" class="sf-ed" aria-label="Detalhes" data-sf-act="editar-divida" data-id="${esc(d.id)}">✎</button></div>
    </div>`).join("")) : "";

  const blocoSemSaldo = semSaldo.length ? detalhes(`${t}|semsaldo`, false, "sf-fora", `Sem nada vencido nem a vencer (${semSaldo.length}) <span class="sf-grupo-tot">confira e marque quitada</span>`,
    semSaldo.map((d) => `<div class="sf-linha sf-linha-fora">
      <div class="sf-l-info"><div class="sf-l-cred">${esc(d.credor)}</div>${idDivida(d)}${notaPagoParcial(d)}</div>
      ${celDevido(d)}
      <div class="sf-l-acoes">${botaoQuitei(d)}<button type="button" class="sf-ed" aria-label="Detalhes" data-sf-act="editar-divida" data-id="${esc(d.id)}">✎</button></div>
    </div>`).join("")) : "";

  const blocoFora = fora.length ? detalhes(`${t}|fora`, false, "sf-fora", `Fora da conta (${fora.length}) <span class="sf-grupo-tot">${esc(fmtCurto(fora.reduce((s, d) => s + devido(d), 0)))}</span>`,
    fora.map((d) => `<div class="sf-linha sf-linha-fora">
      <div class="sf-l-info"><div class="sf-l-cred">${esc(d.credor)}${d.quitada ? " ✓" : ""}</div><div class="sf-l-motivo">${esc(txt(d.subgrupo))} · ${esc(motivoFora(d) || "")}</div></div>
      ${celDevido(d)}
      <div class="sf-l-acoes"><button type="button" class="sf-ed" aria-label="Detalhes" data-sf-act="editar-divida" data-id="${esc(d.id)}">✎</button></div>
    </div>`).join("")) : "";

  sec.innerHTML = `<div id="sfHead-${t}">${cabecalhoTipo(t)}</div>${extraTipo(t)}${lista}${blocoQuit}${blocoSemSaldo}${blocoFora}${blocoComprometidas(t, dentro)}`;
}
function renderTipos(): void { for (const t of TIPOS) renderTipo(t); }

// ───────────────────────── 6. A reaver ─────────────────────────
function cabecalhoReaver(): string {
  const s = somaReaver();
  return `<div class="sf-topo-nums">
    <span class="sf-verde">Pode voltar <strong>${esc(fmtCurto(s.pode))}</strong></span>
    <span>provável <strong>${esc(fmtCurto(s.provavel))}</strong></span>
    <span class="sf-verde">já voltou <strong>${esc(fmtCurto(s.voltou))}</strong></span>
  </div>`;
}
function notaReaver(): string {
  const c = somaReaver().credito;
  return c > 0 ? `<div class="sf-ref">Créditos de 11% e compensações abatem dívida: ${esc(fmtCurto(c))} que não viram dinheiro no caixa.</div>` : "";
}
function atualizarTopoReaver(): void {
  const h = el("sfReaverHead");
  if (h) h.innerHTML = cabecalhoReaver();
  const n = el("sfReaverNota");
  if (n) n.innerHTML = notaReaver();
}
function selectChance(r: SfReaver): string {
  const atual = r.chance || "nao_sei";
  const dis = D.podeEditar ? "" : " disabled";
  return `<select class="sf-chance sf-chance-${esc(atual)}" data-reaver-chance="${esc(r.id)}" aria-label="Chance de voltar"${dis}>${D.chances.map((c) =>
    `<option value="${esc(c)}"${c === atual ? " selected" : ""}>${esc(D.rotuloChance[c] || c)}</option>`).join("")}</select>`;
}
function itemReaver(r: SfReaver): string {
  const dis = D.podeEditar ? "" : " disabled";
  const selo = reaverNoCpf(r) ? `<span class="badge badge-gray">fora da empresa</span>`
    : (reaverAbateDivida(r) ? `<span class="badge badge-blue" title="Não vira dinheiro no caixa">abate dívida</span>` : "");
  return `<div class="sf-rv${reaverNoCpf(r) ? " sf-rv-fora" : ""}" data-reaver-item="${esc(r.id)}">
    <div class="sf-rv-top"><strong>${esc(r.titulo)}</strong>${r.contraparte ? `<span class="sf-muted">${esc(r.contraparte)}</span>` : ""}${selo}</div>
    ${r.situacao ? `<div class="sf-rv-sit" title="${esc(r.situacao)}">${esc(r.situacao)}</div>` : ""}
    <div class="sf-rv-linha">
      <div class="sf-rv-campo"><label class="sf-l-rot" for="sfrv-${esc(r.id)}">Valor estimado</label>
        <input id="sfrv-${esc(r.id)}" class="sf-in" type="text" inputmode="decimal" data-reaver-valor="${esc(r.id)}" value="${esc(valorParaCampo(r.valor_estimado))}"${dis} /></div>
      <div><span class="sf-l-rot">Chance</span>${selectChance(r)}</div>
      <span class="sf-rv-prev">${r.previsao ? `⏱ ${esc(r.previsao)}` : ""}</span>
      <div class="sf-l-acoes">
        ${D.podeEditar ? `<button type="button" class="sf-quitei" data-requer-edicao data-sf-act="receber" data-id="${esc(r.id)}">✓ Recebi</button>` : ""}
        <button type="button" class="sf-ed" aria-label="Detalhes" data-sf-act="editar-reaver" data-id="${esc(r.id)}">✎</button>
      </div>
    </div>
  </div>`;
}
function renderReaver(): void {
  const sec = el("sfSecReaver");
  if (!sec) return;
  const todosAbertos = reaverAberto();
  const noCpf = todosAbertos.filter(reaverNoCpf);
  const abertos = todosAbertos.filter((r) => !reaverNoCpf(r));
  const recebidos = reaverRecebido();
  const temCredito = abertos.some(reaverAbateDivida);
  let grupos = "";
  for (const tipo of D.tiposReaver) {
    const l = abertos.filter((r) => r.tipo === tipo);
    if (!l.length) continue;
    const soma = l.reduce((s, r) => s + n0(r.valor_estimado), 0);
    grupos += detalhes(`reaver|${tipo}`, true, "sf-grupo", `${esc(D.rotuloTipoReaver[tipo] || tipo)} <span class="sf-muted">(${l.length})</span><span class="sf-grupo-tot">${esc(fmtCurto(soma))}</span>`,
      `<div class="sf-rv-lista">${l.map(itemReaver).join("")}</div>`);
  }
  // tipo fora da lista conhecida (não deveria acontecer) não some
  const outros = abertos.filter((r) => !D.tiposReaver.includes(r.tipo));
  if (outros.length) grupos += detalhes("reaver|?", true, "sf-grupo", `Sem tipo <span class="sf-muted">(${outros.length})</span>`, `<div class="sf-rv-lista">${outros.map(itemReaver).join("")}</div>`);
  if (!abertos.length) grupos = `<div class="empty-state"><strong>Nada a reaver na lista.</strong>Use “+ Adicionar” para incluir processos, créditos ou consórcios.</div>`;
  // no CPF da sócia: à parte, cinza, fora do "pode voltar" e do "provável" (só entra na empresa se ela repassar)
  if (noCpf.length) grupos += detalhes("reaver|cpf", false, "sf-fora", `Fora da empresa — no CPF <span class="sf-muted">(${noCpf.length})</span><span class="sf-grupo-tot">${esc(fmtCurto(noCpf.reduce((s, r) => s + n0(r.valor_estimado), 0)))}</span>`,
    `<div class="sf-rv-lista">${noCpf.map(itemReaver).join("")}</div>`);

  const blocoRec = recebidos.length ? detalhes("reaver|recebidos", false, "sf-quitadas", `✓ Recebidos (${recebidos.length}) <span class="sf-grupo-tot">${esc(fmtCurto(somaReaver().voltou))}</span>`,
    recebidos.map((r) => `<div class="sf-rv-ok"><strong>${esc(r.titulo)}</strong>
      <span>${esc(fmtR(num(r.valor_recebido) ?? r.valor_estimado))}${r.recebido_em ? ` em ${esc(fmtData(r.recebido_em))}` : ""}</span>
      <span class="sf-l-acoes">${D.podeEditar ? `<button type="button" class="sf-ed" data-requer-edicao data-sf-act="desfazer-receber" data-id="${esc(r.id)}">desfazer</button>` : ""}<button type="button" class="sf-ed" aria-label="Detalhes" data-sf-act="editar-reaver" data-id="${esc(r.id)}">✎</button></span>
    </div>`).join("")) : "";

  sec.innerHTML = `<div class="sf-topo"><div id="sfReaverHead">${cabecalhoReaver()}</div>
      ${D.podeEditar ? `<button type="button" class="btn btn-primary btn-sm" data-requer-edicao data-sf-act="novo-reaver">+ Adicionar</button>` : ""}</div>
    <div id="sfReaverNota">${temCredito ? notaReaver() : ""}</div>
    ${grupos}${blocoRec}`;
}

// ───────────────────────── 7. Plano de ação (v2) ─────────────────────────
function cabecalhoPlano(): string {
  return `<div class="sf-topo-nums">
    <span class="sf-verde">Vendido com o plano <strong>${esc(fmtR(vendidoPlano()))}</strong></span>
    <span><strong>${emAndamento()}</strong> ideia(s) em andamento</span>
  </div>`;
}
/** Descrição da ideia fica recolhida ("mais"): o card mostra só o que a spec pede. */
function maisPlano(a: SfAcao): string {
  const chave = `plano|desc|${a.id}`;
  const aberto = detAberto.get(chave) === true;
  return `<details class="sf-pl-mais" data-det="${esc(chave)}"${aberto ? " open" : ""}><summary>mais</summary><div class="sf-pl-desc">${esc(a.descricao)}</div></details>`;
}
function cardPlano(a: SfAcao): string {
  const dis = D.podeEditar ? "" : " disabled";
  const passos = arr<string>(a.primeiros_passos).slice(0, 3);
  const st = a.status || "ideia";
  return `<article class="sf-pl${st === "feito" ? " sf-pl-feito" : ""}${st === "descartado" ? " sf-pl-descartado" : ""}">
    <div class="sf-pl-h"><strong>${esc(a.titulo)}</strong><span class="badge ${a.grupo === "caixa" ? "badge-blue" : "badge-purple"}">${a.grupo === "caixa" ? "Caixa" : "Renda"}</span></div>
    <div class="sf-pl-meta">
      ${a.como_o_mercado_fatura ? `<span><b>Preço:</b> ${esc(a.como_o_mercado_fatura)}</span>` : ""}
      ${a.prazo_primeiro_faturamento ? `<span><b>1ª venda em ~</b> ${esc(a.prazo_primeiro_faturamento)}</span>` : ""}
      ${a.potencial_mensal ? `<span><b>Potencial:</b> ${esc(a.potencial_mensal)}</span>` : ""}
    </div>
    ${a.precisa_de ? `<div class="sf-pl-cuidado">⚠ ${esc(a.precisa_de)}</div>` : ""}
    ${passos.length ? `<ol class="sf-pl-passos">${passos.map((p) => `<li>${esc(p)}</li>`).join("")}</ol>` : ""}
    ${a.descricao ? maisPlano(a) : ""}
    <div class="sf-pl-form">
      <div><label class="sf-l-rot" for="sfas-${esc(a.id)}">Situação</label>
        <select id="sfas-${esc(a.id)}" data-acao-status="${esc(a.id)}"${dis}>${D.statusAcao.map((s) => `<option value="${esc(s)}"${s === st ? " selected" : ""}>${esc(D.rotuloStatus[s] || s)}</option>`).join("")}</select></div>
      <div><label class="sf-l-rot" for="sfav-${esc(a.id)}">Vendi R$</label>
        <input id="sfav-${esc(a.id)}" class="sf-in" type="text" inputmode="decimal" placeholder="0,00" data-acao-vendido="${esc(a.id)}" value="${esc(valorParaCampo(a.valor_vendido))}"${dis} /></div>
    </div>
  </article>`;
}
let verV1 = false;
function renderPlano(): void {
  const sec = el("sfSecPlano");
  if (!sec) return;
  const ord = (l: SfAcao[]) => [...l].sort((a, b) => (n0(a.ordem) - n0(b.ordem)) || (n0(a.codigo) - n0(b.codigo)));
  const caixa = ord(D.acoes.filter((a) => a.grupo === "caixa"));
  const renda = ord(D.acoes.filter((a) => a.grupo !== "caixa"));
  const v1 = D.acoesV1;
  const corpo = !D.acoes.length
    ? `<div class="empty-state"><strong>Nenhuma ideia no plano novo ainda.</strong></div>`
    : `${caixa.length ? `<div class="sf-blk">${blkTitulo("cash", "Caixa para a empresa")}<p class="sf-cpf">Dinheiro que vai direto para a dívida.</p><div class="sf-pl-grid">${caixa.map(cardPlano).join("")}</div></div>` : ""}
       ${renda.length ? `<div class="sf-blk">${blkTitulo("bulb", "Renda com o que você sabe fazer")}<p class="sf-cpf">Entra no seu CPF — confirme com o advogado antes de concentrar numa conta.</p><div class="sf-pl-grid">${renda.map(cardPlano).join("")}</div></div>` : ""}`;
  sec.innerHTML = `<div class="sf-topo" id="sfPlanoHead">${cabecalhoPlano()}</div>
    ${corpo}
    ${v1.length ? `<p><button type="button" class="sf-link" data-sf-act="ver-v1">${verV1 ? "esconder" : "ver"} plano antigo (13/10)</button></p>
      ${verV1 ? `<ol class="sf-v1">${v1.map((a) => `<li>${esc(a.titulo)}${a.descartada ? " <span class=\"sf-muted\">(descartada)</span>" : ""}</li>`).join("")}</ol>` : ""}` : ""}`;
}

// ───────────────────────── 8. Protestos ─────────────────────────
type FiltrosProt = { protTab: string; protGrupo: string; protBusca: string };
const filtros: FiltrosProt = { protTab: "", protGrupo: "", protBusca: "" };
try {
  const salvo = JSON.parse(lsGet("sf:filtros") || "null") as Partial<FiltrosProt> | null;
  if (salvo && typeof salvo === "object") {
    for (const k of Object.keys(filtros) as Array<keyof FiltrosProt>) if (typeof salvo[k] === "string") filtros[k] = salvo[k] as string;
  }
} catch { /* filtros padrão */ }
function salvarFiltros(): void { lsSet("sf:filtros", JSON.stringify(filtros)); }
const SECOES_PROT: Array<[string, string]> = [
  ["protestado_cenprot", "Protestados (CENPROT)"],
  ["pgfn_intimado", "PGFN — intimados para protesto"],
  ["fora_da_cenprot", "Fora da CENPROT"],
];
const GRUPOS_PROT: Array<[string, string]> = [
  ["", "Todos os credores"], ["abertos", "Ainda não cancelados"], ["cancelados", "Já cancelados"],
  ["imposto", "Impostos"], ["banco", "Bancos"], ["fornecedor", "Fornecedores"], ["pagos", "Pagos na Vobi (falta cancelar)"],
];
function grupoDoProtesto(p: SfProtesto): string { return txt(p.grupo).trim() || "fornecedor"; }
/** Protesto que está no CPF da sócia (não no CNPJ da empresa). */
function protestoNoCpf(p: SfProtesto): boolean { return /CPF DA (ADRIANA|S[OÓ]CIA)/i.test(txt(p.observacao)); }
/** Título que a Vobi registra como pago (pode faltar só cancelar o protesto). */
function protestoPago(p: SfProtesto): boolean { return /^pago/i.test(txt(p.situacao_vobi).trim()); }
function rotuloSecao(k: string): string {
  const s = SECOES_PROT.find(([x]) => x === k);
  if (s) return s[1];
  const t = k.replace(/_/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "Sem seção";
}
function cabecalhoProtestos(): string {
  const cen = D.protestos.filter((p) => p.secao === "protestado_cenprot");
  const cenCanc = cen.filter((p) => p.cancelado).length;
  const pct = cen.length ? (cenCanc / cen.length) * 100 : 0;
  const abertos = D.protestos.filter((p) => !p.cancelado);
  // custas no mesmo conjunto do contador (CENPROT ainda não cancelados); as intimações da PGFN vão à parte
  const custas = cen.filter((p) => !p.cancelado).reduce((s, p) => s + n0(p.custas), 0);
  const custasPgfn = D.protestos.filter((p) => p.secao === "pgfn_intimado" && !p.cancelado).reduce((s, p) => s + n0(p.custas), 0);
  const valorAberto = abertos.reduce((s, p) => s + n0(p.valor_protestado), 0);
  const canc = D.protestos.length - abertos.length;
  const respondidos = D.protestos.filter((p) => txt(p.resposta_cartorio).trim()).length;
  return `<div class="sf-prot-hero">
      <div class="sf-prot-hero-t"><span><strong>${cenCanc} de ${cen.length}</strong> protestos da CENPROT cancelados</span><span class="sf-small">custas ainda a pagar: <strong style="font-size:.95rem;color:var(--ink)">${esc(fmtR(custas))}</strong>${custasPgfn > 0 ? ` · + ${esc(fmtR(custasPgfn))} das intimações da PGFN` : ""}</span></div>
      <div class="sf-prog"><div class="sf-prog-bar" style="width:${pctBarra(pct)}%"></div></div>
    </div>
    <div class="sf-kpis">
      <div class="sf-kpi"><div class="sf-kpi-v">${D.protestos.length}</div><div class="sf-kpi-l">Títulos na lista (${canc} cancelado${canc === 1 ? "" : "s"})</div></div>
      <div class="sf-kpi"><div class="sf-kpi-v sf-neg">${esc(fmtR(valorAberto))}</div><div class="sf-kpi-l">Protestado ou intimado, ainda não cancelado</div></div>
      <div class="sf-kpi"><div class="sf-kpi-v">${respondidos} de ${D.protestos.length}</div><div class="sf-kpi-l">Com resposta do cartório</div></div>
    </div>`;
}
function renderProtestos(): void {
  const sec = el("sfSecProtestos");
  if (!sec) return;
  if (!D.protestos.length) {
    sec.innerHTML = `<div class="empty-state"><strong>Nenhum protesto cadastrado.</strong>${D.faltaMigration ? "As tabelas ainda não foram criadas." : ""}</div>`;
    return;
  }
  const tabs = [...new Set(D.protestos.map((p) => txt(p.tabeliao).trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
  if (filtros.protTab && !tabs.includes(filtros.protTab)) filtros.protTab = "";
  if (filtros.protGrupo && !GRUPOS_PROT.some(([v]) => v === filtros.protGrupo)) filtros.protGrupo = "";
  const celular = window.matchMedia("(max-width: 640px)").matches;
  const aberto = detAberto.has("prot|tabela") ? detAberto.get("prot|tabela") : !celular;
  sec.innerHTML = `<div id="sfProtHead">${cabecalhoProtestos()}</div>
    <div class="sf-box sf-box-azul"><strong>Não some de novo:</strong>estes títulos já estão nas abas de dívida. Aqui é o acompanhamento do cartório.</div>
    <details class="sf-det" data-det="prot|tabela"${aberto ? " open" : ""}><summary>Títulos e respostas dos cartórios (${D.protestos.length})</summary>
      <div class="sf-prot-body">
        <div class="sf-toolbar">
          <select class="filter-select" data-sf-f="protGrupo" aria-label="Filtro">${GRUPOS_PROT.map(([v, r]) => `<option value="${esc(v)}"${filtros.protGrupo === v ? " selected" : ""}>${esc(r)}</option>`).join("")}</select>
          <select class="filter-select" data-sf-f="protTab" aria-label="Tabelião"><option value="">Todos os tabeliães</option>${tabs.map((t) => `<option value="${esc(t)}"${filtros.protTab === t ? " selected" : ""}>${esc(t)}</option>`).join("")}</select>
          <input type="search" class="search-input" placeholder="Buscar credor, documento, protocolo…" data-sf-f="protBusca" value="${esc(filtros.protBusca)}" aria-label="Buscar protesto" />
        </div>
        <div id="sfProtLista"></div>
      </div>
    </details>`;
  renderProtLista();
}
function filtraProt(p: SfProtesto): boolean {
  if (filtros.protTab && txt(p.tabeliao).trim() !== filtros.protTab) return false;
  const g = filtros.protGrupo;
  if (g === "pagos" && !protestoPago(p)) return false;
  if (g === "cancelados" && !p.cancelado) return false;
  if (g === "abertos" && p.cancelado) return false;
  if (["imposto", "banco", "fornecedor"].includes(g) && grupoDoProtesto(p) !== g) return false;
  const q = norm(filtros.protBusca);
  if (q) {
    const s = norm([p.credor, p.credor_cnpj, p.documento, p.protocolo, p.observacao, p.tabeliao, p.situacao_vobi, p.resposta_cartorio].map(txt).join(" "));
    if (!s.includes(q)) return false;
  }
  return true;
}
function renderProtLista(): void {
  const alvo = el("sfProtLista");
  if (!alvo) return;
  const l = D.protestos.filter(filtraProt);
  if (!l.length) { alvo.innerHTML = `<div class="empty-state"><strong>Nenhum título com esses filtros.</strong></div>`; return; }
  const hoje = hojeISO();
  const secoes = SECOES_PROT.map(([k]) => k);
  for (const p of l) if (!secoes.includes(p.secao)) secoes.push(p.secao);
  let html = "";
  for (const chave of secoes) {
    const ps = l.filter((p) => p.secao === chave);
    if (!ps.length) continue;
    const rotulo = rotuloSecao(chave);
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
      const selos = `${p.cancelado ? `<span class="sf-selo-canc">✓ Cancelado${p.cancelado_em ? " em " + esc(fmtDataCurta(p.cancelado_em)) : ""}</span>` : ""}${!p.cancelado && protestoPago(p) ? `<span class="sf-selo-pago" title="Consta como pago na Vobi; falta cancelar o protesto.">Pago (Vobi)</span>` : ""}${protestoNoCpf(p) ? `<span class="sf-selo-cpf" title="O protesto está no CPF da sócia, não no CNPJ da empresa.">No CPF da sócia</span>` : ""}`;
      const botao = D.podeEditar
        ? (p.cancelado
          ? `<div><button type="button" class="sf-ed" data-requer-edicao data-sf-act="desfazer-prot" data-id="${esc(p.id)}">desfazer</button></div>`
          : `<div><button type="button" class="sf-btn-canc" data-requer-edicao data-sf-act="cancelar-prot" data-id="${esc(p.id)}">✓ Cancelado</button></div>`)
        : "";
      // 2 linhas por título: os dados e, embaixo (largura inteira), a resposta do cartório
      return `<tr class="sf-prot-l1${p.cancelado ? " sf-prot-canc" : ""}">
        <td class="sf-small">${esc(p.tabeliao)}</td>
        <td class="sf-prot-cred"><strong>${esc(p.credor)}</strong>${selos ? `<div>${selos}</div>` : ""}${p.credor_cnpj ? `<div class="sf-muted">${esc(p.credor_cnpj)}</div>` : ""}${p.situacao_vobi ? `<div class="sf-muted">Na Vobi: ${esc(txt(p.situacao_vobi).replace(/\s+na Vobi$/i, ""))}</div>` : ""}${p.observacao ? `<div class="sf-obs" style="margin-top:3px">${esc(p.observacao)}</div>` : ""}${botao}</td>
        <td class="sf-small">${esc(p.documento || "")}</td>
        <td class="sf-num">${esc(fmtR(p.valor_principal))}</td>
        <td class="sf-num">${esc(fmtR(p.valor_protestado))}${p.data_protesto ? `<div class="sf-muted">em ${esc(fmtData(p.data_protesto))}</div>` : ""}</td>
        <td class="sf-num">${esc(fmtR(p.custas))}</td>
        <td style="white-space:nowrap">${esc(fmtData(p.vencimento))}</td>
        <td class="sf-small">${esc(p.protocolo || "")}${p.data_protocolo ? `<div class="sf-muted">${esc(fmtData(p.data_protocolo))}</div>` : ""}</td>
        <td style="white-space:nowrap"${prazoVenc ? ` class="sf-neg" title="Prazo já passou"` : ""}>${esc(fmtData(p.prazo_limite))}</td>
        <td>${badgeConfianca(p.confianca)}</td></tr>
      <tr class="sf-prot-l2${p.cancelado ? " sf-prot-canc" : ""}"><td class="sf-prot-l2-pad"></td><td colspan="9"><div class="sf-resp-box"><div class="sf-resp-rot">Resposta do cartório</div>${respCel}</div></td></tr>`;
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
  if (btn) btn.disabled = vivoCarregando || sincronizando;
  if (st) {
    st.className = "sf-live-st";
    st.title = "";
    if (sincronizando) {
      st.classList.add("sf-live-loading");
      st.innerHTML = `<span class="spinner"></span> Vobi: conferindo vencidos e a vencer…`;
    } else if (vivoCarregando) {
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
/** Partes que dependem da Vobi. A aba de fornecedores só troca a linha de referência (não perde o que está sendo digitado). */
function renderPartesVivas(): void {
  renderLiveStatus();
  renderPainel();
  const ref = el("sfVobiForn");
  if (ref) ref.innerHTML = linhaVobiFornecedores();
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
/** Sincronização das dívidas ligadas a um fornecedor da Vobi (vencido / a vencer / próximo vencimento / quitada). */
let sincronizando = false;
type RespSinc = {
  atualizadas?: number; linhas?: Array<Partial<SfDivida> & { id?: string }>;
  conflitos?: Array<{ credores?: string[] }>; falhas?: Array<{ credor?: string }>;
  /** ligadas cujo fornecedor não apareceu com nada em aberto na leitura: nada foi gravado — ela confere e marca */
  paraConferir?: Array<{ credor?: string }>;
};
async function sincronizarVobi(): Promise<void> {
  if (sincronizando) return;
  sincronizando = true;
  renderLiveStatus();
  try {
    // corpo vazio, mas em JSON: o content-type é obrigatório nas mutações (CSRF do Astro)
    const r = await enviarJson<RespSinc>("POST", `${API}/sincronizar`, {});
    for (const l of arr<Partial<SfDivida> & { id?: string }>(r?.linhas)) {
      if (l && typeof l.id === "string") mesclar(D.dividas, l.id, {}, l);
    }
    const at = n0(r?.atualizadas);
    const conf = arr<{ credores?: string[] }>(r?.conflitos);
    const falhas = arr<{ credor?: string }>(r?.falhas);
    const conferir = arr<{ credor?: string }>(r?.paraConferir);
    if (at > 0) { renderTipos(); renderPainel(); }
    if (at > 0) toast(`Vobi: ${at} dívida(s) atualizada(s) (vencido e a vencer).`);
    if (conf.length || falhas.length || conferir.length) {
      const partes: string[] = [];
      if (conferir.length) partes.push(`${conferir.length} dívida(s) sem nada em aberto na Vobi (${conferir.map((c) => txt(c.credor)).slice(0, 4).join(", ")}) — não mexi: se já pagou, marque ✓ Quitei; senão confira o nº do fornecedor no ✎`);
      if (conf.length) partes.push(`${conf.length} fornecedor(es) ligado(s) a mais de uma linha (${conf.flatMap((c) => arr<string>(c.credores)).slice(0, 4).join(", ")}) — não sincronizei esses`);
      if (falhas.length) partes.push(`${falhas.length} linha(s) não gravada(s)`);
      window.setTimeout(() => toast(partes.join("; ") + ".", "erro"), at > 0 ? 3400 : 0);
    }
  } catch (e) {
    toast(`Sincronização com a Vobi: ${e instanceof Error ? e.message : String(e)}`, "erro");
  } finally {
    sincronizando = false;
    renderLiveStatus();
  }
}
/** Botão "Atualizar da Vobi": lê a Vobi de novo e, se a leitura veio boa, sincroniza as dívidas ligadas a ela. */
async function atualizarESincronizar(): Promise<void> {
  if (vivoCarregando || sincronizando) return;
  await carregarVivo(true);
  if (!D.podeEditar || !vivo || vivoErro || vivo.aviso || !vivo.aberto) return;
  if (!D.dividas.some((d) => d.ativo !== false && !d.quitada && num(d.vobi_fornecedor_id) != null)) return;
  await sincronizarVobi();
}
function sfAtualizarVobi(): void { void atualizarESincronizar(); }

// ───────────────────────── gravações ─────────────────────────
async function enviarJson<T>(metodo: "POST" | "PATCH" | "DELETE", url: string, body: Record<string, unknown>): Promise<T> {
  const r = await fetch(url, { method: metodo, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
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
function patchJson<T>(url: string, body: Record<string, unknown>): Promise<T> { return enviarJson<T>("PATCH", url, body); }
const API = "/api/admin/situacao-financeira";
function mesclar<T extends { id: string }>(lista: T[], id: string, parcial: Partial<T>, linha: unknown): T | undefined {
  const i = lista.findIndex((x) => x.id === id);
  if (i < 0) return undefined;
  lista[i] = { ...lista[i], ...parcial, ...(linha && typeof linha === "object" ? (linha as Partial<T>) : {}) };
  return lista[i];
}
/** Gravações da LISTA ainda em voo, por linha ("divida:<id>", "reaver:<id>"). O ✎ e o "✓ Quitei/Recebi" esperam
 *  por elas: tocar no botão logo depois de digitar dispara o "change" (PATCH) e o clique quase juntos, e o modal
 *  não pode abrir com o valor antigo. */
const pendentes = new Map<string, Set<Promise<unknown>>>();
function registrarPendente(chave: string, p: Promise<unknown>): void {
  let s = pendentes.get(chave);
  if (!s) { s = new Set(); pendentes.set(chave, s); }
  const set = s;
  set.add(p);
  const fim = () => { set.delete(p); if (!set.size && pendentes.get(chave) === set) pendentes.delete(chave); };
  p.then(fim, fim);
}
async function esperarPendente(chave: string): Promise<void> {
  const s = pendentes.get(chave);
  if (s && s.size) await Promise.allSettled([...s]);
}
/** Retrato dos campos de um modal ao abrir: ao salvar, só vai o que mudou em relação a ele. */
function retrato(ids: string[]): Record<string, string> {
  const r: Record<string, string> = {};
  for (const i of ids) r[i] = campo(i)?.value ?? "";
  return r;
}
function mudou(snap: Record<string, string>, id: string): boolean { return (campo(id)?.value ?? "") !== (snap[id] ?? ""); }
function marcar(inp: HTMLElement, estado: "salvando" | "ok" | "erro" | "", titulo = ""): void {
  inp.classList.remove("sf-salvando", "sf-ok", "sf-erro");
  if (estado) inp.classList.add(`sf-${estado}`);
  inp.title = titulo;
  if (estado === "ok") window.setTimeout(() => inp.classList.remove("sf-ok"), 1800);
}
/** Lê um campo de reais; devolve undefined (e marca o erro) quando inválido. */
function valorDoCampo(inp: HTMLInputElement): number | null | undefined {
  const v = lerValor(inp.value);
  if (v != null && (Number.isNaN(v) || v < 0)) {
    marcar(inp, "erro", "Valor inválido. Use números, ex.: 1.234,56");
    toast("Valor inválido. Use números, ex.: 1.234,56", "erro");
    return undefined;
  }
  return v == null ? null : Math.round(v * 100) / 100;
}

/** Proposta de quitação digitada na linha (salva ao sair do campo / Enter). */
async function salvarProposta(inp: HTMLInputElement): Promise<void> {
  const id = inp.dataset.propId || "";
  const d = D.dividas.find((x) => x.id === id);
  if (!d || !D.podeEditar) return;
  const v = valorDoCampo(inp);
  if (v === undefined) return;
  if (v === (num(d.valor_proposta) ?? null)) { inp.value = valorParaCampo(v); marcar(inp, ""); return; }
  marcar(inp, "salvando");
  try {
    const linha = await patchJson<Partial<SfDivida>>(`${API}/dividas/${encodeURIComponent(id)}`, { valor_proposta: v });
    const nova = mesclar(D.dividas, id, { valor_proposta: v }, linha);
    if (document.activeElement !== inp) inp.value = valorParaCampo(nova?.valor_proposta ?? v);
    marcar(inp, "ok");
    const econ = document.querySelector<HTMLElement>(`[data-econ-id="${CSS.escape(id)}"]`);
    if (econ && nova) econ.textContent = textoEconomia(nova);
    // totais do subgrupo e do bloco (com/sem cobrança) sem redesenhar a lista: o foco pode já estar no próximo campo
    const doBloco = vencidasDo(d.grupo as Tipo, cobrancaDe(d));
    const tot = inp.closest("details")?.querySelector<HTMLElement>(":scope > summary .sf-grupo-tot");
    if (tot) {
      const sub = subgrupoDe(d);
      tot.innerHTML = totSubgrupo(doBloco.filter((x) => subgrupoDe(x) === sub));
    }
    const btot = inp.closest(".sf-bloco")?.querySelector<HTMLElement>(":scope > .sf-bloco-t .sf-bloco-tot");
    if (btot) btot.innerHTML = totSubgrupo(doBloco);
    renderCabecalhoTipo(d.grupo as Tipo);
    renderPainel();
  } catch (e) {
    marcar(inp, "erro", e instanceof Error ? e.message : String(e));
    toast(e instanceof Error ? e.message : String(e), "erro");
  }
}
async function salvarValorReaver(inp: HTMLInputElement): Promise<void> {
  const id = inp.dataset.reaverValor || "";
  const r = D.reaver.find((x) => x.id === id);
  if (!r || !D.podeEditar) return;
  const v = valorDoCampo(inp);
  if (v === undefined) return;
  if (v === (num(r.valor_estimado) ?? null)) { inp.value = valorParaCampo(v); marcar(inp, ""); return; }
  marcar(inp, "salvando");
  try {
    const linha = await patchJson<Partial<SfReaver>>(`${API}/reaver/${encodeURIComponent(id)}`, { valor_estimado: v });
    const novo = mesclar(D.reaver, id, { valor_estimado: v }, linha);
    if (document.activeElement !== inp) inp.value = valorParaCampo(novo?.valor_estimado ?? v);
    marcar(inp, "ok");
    atualizarTopoReaver();
    renderPainel();
  } catch (e) {
    marcar(inp, "erro", e instanceof Error ? e.message : String(e));
    toast(e instanceof Error ? e.message : String(e), "erro");
  }
}
async function salvarChanceReaver(sel: HTMLSelectElement): Promise<void> {
  const id = sel.dataset.reaverChance || "";
  const r = D.reaver.find((x) => x.id === id);
  if (!r || !D.podeEditar) return;
  const v = sel.value;
  const antes = r.chance || "nao_sei";
  sel.className = `sf-chance sf-chance-${v}`;
  marcar(sel, "salvando");
  try {
    const linha = await patchJson<Partial<SfReaver>>(`${API}/reaver/${encodeURIComponent(id)}`, { chance: v });
    mesclar(D.reaver, id, { chance: v as SfReaver["chance"] }, linha);
    marcar(sel, "ok");
    atualizarTopoReaver();
    renderPainel();
  } catch (e) {
    sel.value = antes;
    sel.className = `sf-chance sf-chance-${antes}`;
    toast(e instanceof Error ? e.message : String(e), "erro");
  }
}
async function salvarStatusAcao(sel: HTMLSelectElement): Promise<void> {
  const id = sel.dataset.acaoStatus || "";
  const a = acaoPorId(id);
  if (!a || !D.podeEditar) return;
  const v = sel.value;
  const antes = a.status || "ideia";
  if (!D.statusAcao.includes(v)) { sel.value = antes; return; }
  marcar(sel, "salvando");
  try {
    const linha = await patchJson<Partial<SfAcao>>(`${API}/acoes/${encodeURIComponent(id)}`, { status: v });
    mesclar(D.acoes, id, { status: v as SfAcao["status"] }, linha);
    marcar(sel, "ok");
    const card = sel.closest(".sf-pl");
    card?.classList.toggle("sf-pl-feito", v === "feito");
    card?.classList.toggle("sf-pl-descartado", v === "descartado");
    const h = el("sfPlanoHead");
    if (h) h.innerHTML = cabecalhoPlano();
    if (v === "feito") toast(`“${a.titulo}” feito!`);
  } catch (e) {
    sel.value = antes;
    marcar(sel, "");
    toast(e instanceof Error ? e.message : String(e), "erro");
  }
}
async function salvarVendidoAcao(inp: HTMLInputElement): Promise<void> {
  const id = inp.dataset.acaoVendido || "";
  const a = acaoPorId(id);
  if (!a || !D.podeEditar) return;
  const v = valorDoCampo(inp);
  if (v === undefined) return;
  const antes = num(a.valor_vendido) ?? null;
  if (v === antes) { inp.value = valorParaCampo(v); marcar(inp, ""); return; }
  marcar(inp, "salvando");
  try {
    const linha = await patchJson<Partial<SfAcao>>(`${API}/acoes/${encodeURIComponent(id)}`, { valor_vendido: v });
    const nova = mesclar(D.acoes, id, { valor_vendido: v }, linha);
    if (document.activeElement !== inp) inp.value = valorParaCampo(nova?.valor_vendido ?? v);
    marcar(inp, "ok");
    const h = el("sfPlanoHead");
    if (h) h.innerHTML = cabecalhoPlano();
    renderPainel();
    if ((v ?? 0) > (antes ?? 0)) toast(`Venda anotada! Já são ${fmtR(vendidoPlano())} com o plano.`);
  } catch (e) {
    marcar(inp, "erro", e instanceof Error ? e.message : String(e));
    toast(e instanceof Error ? e.message : String(e), "erro");
  }
}

// ── protestos: resposta do cartório e cancelado ──
async function sfSalvarProtesto(id: string): Promise<void> {
  const p = D.protestos.find((x) => x.id === id);
  if (!p) return;
  const resp = (rascProt[id] ?? txt(p.resposta_cartorio)).trim();
  const btn = document.querySelector<HTMLButtonElement>(`[data-sf-act="salvar-prot"][data-id="${CSS.escape(id)}"]`);
  const msgEl = document.querySelector<HTMLElement>(`[data-msg-prot="${CSS.escape(id)}"]`);
  const setMsg = (m: { ok: boolean; texto: string } | null, texto = "") => {
    if (!msgEl) return;
    msgEl.className = "sf-msg" + (m ? (m.ok ? " ok" : " erro") : "");
    msgEl.textContent = m ? m.texto : texto;
  };
  if (btn) btn.disabled = true;
  setMsg(null, "Salvando…");
  try {
    const linha = await patchJson<Partial<SfProtesto>>(`${API}/protestos/${encodeURIComponent(id)}`, { resposta_cartorio: resp || null });
    mesclar(D.protestos, id, { resposta_cartorio: resp || null }, linha);
    delete rascProt[id];
    msgProt[id] = { ok: true, texto: `Salvo às ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` };
    setMsg(msgProt[id]);
    const h = el("sfProtHead");
    if (h) h.innerHTML = cabecalhoProtestos();
  } catch (e) {
    msgProt[id] = { ok: false, texto: e instanceof Error ? e.message : String(e) };
    setMsg(msgProt[id]);
  } finally {
    if (btn) btn.disabled = false;
  }
}
async function marcarProtesto(id: string, cancelado: boolean): Promise<void> {
  const p = D.protestos.find((x) => x.id === id);
  if (!p) return;
  if (!cancelado && !window.confirm(`Desfazer o cancelamento do protesto de ${p.credor}?`)) return;
  try {
    const body: Record<string, unknown> = { cancelado };
    if (cancelado) body.cancelado_em = hojeISO();
    const linha = await patchJson<Partial<SfProtesto>>(`${API}/protestos/${encodeURIComponent(id)}`, body);
    mesclar(D.protestos, id, cancelado ? { cancelado: true, cancelado_em: hojeISO() } : { cancelado: false }, linha);
    const h = el("sfProtHead");
    if (h) h.innerHTML = cabecalhoProtestos();
    renderProtLista();
    renderPainel();
    if (cancelado) {
      const cen = D.protestos.filter((x) => x.secao === "protestado_cenprot");
      toast(`Protesto cancelado! ${cen.filter((x) => x.cancelado).length} de ${cen.length} da CENPROT.`);
    }
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), "erro");
  }
}

// ── "✓ Quitei" (dívida) e "✓ Recebi" (a reaver): mesmo mini-diálogo ──
let quitarCtx: { tipo: "divida" | "reaver"; id: string } | null = null;
function campo(id: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null {
  return document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
}
function setCampo(id: string, v: string): void { const c = campo(id); if (c) c.value = v; }
function msgModal(id: string, texto: string, erro = false): void {
  const m = el(id);
  if (m) { m.className = "sf-msg" + (texto ? (erro ? " erro" : "") : ""); m.textContent = texto; }
}
async function abrirQuitar(tipo: "divida" | "reaver", id: string): Promise<void> {
  const modal = el("sfModalQuitar");
  if (!modal || !D.podeEditar) return;
  await esperarPendente(`${tipo}:${id}`); // a proposta/valor recém-digitado na linha precisa chegar antes
  const nota = el("sfMqNota");
  if (nota) nota.textContent = "";
  if (tipo === "divida") {
    const d = D.dividas.find((x) => x.id === id);
    if (!d) return;
    const dv = divisao(d);
    const pp = pagoParcial(d);
    // com a vencer: paga SÓ o vencido — o que ainda vai vencer continua comprometido (não some sem ela cortar)
    const parcial = dv.aVencer > 0;
    (el("sfMqTitulo") as HTMLElement).textContent = parcial ? "✓ Paguei o vencido" : "✓ Quitei esta dívida";
    (el("sfMqTexto") as HTMLElement).textContent = [d.credor, d.identificacao].filter(Boolean).join(" — ");
    (el("sfMqValorRot") as HTMLElement).textContent = pp > 0 ? "Quanto pagou agora? (R$)" : "Quanto pagou? (R$)";
    if (nota) {
      const partes: string[] = [];
      if (parcial) partes.push(`Sai da dívida só o vencido. O que ainda vai vencer (${fmtR(dv.aVencer)}${dv.proximo ? `, próximo em ${fmtData(dv.proximo)}` : ""}) continua como despesa comprometida.`);
      if (pp > 0) partes.push(`Já anotado antes: ${fmtR(pp)} pagos do vencido — informe só o pagamento de agora.`);
      nota.textContent = partes.join(" ");
    }
    // linha aberta: valor_pago guarda pagamentos parciais anteriores, não serve de sugestão; sugere o realista.
    // Sem valor nenhum (devido 0): o campo vem vazio e é obrigatório — nada de gravar "pagou R$ 0,00" sem querer
    const sugerido = realista(d);
    setCampo("sfMqValor", sugerido > 0 ? valorParaCampo(sugerido) : "");
    setCampo("sfMqData", hojeISO());
  } else {
    const r = D.reaver.find((x) => x.id === id);
    if (!r) return;
    (el("sfMqTitulo") as HTMLElement).textContent = "✓ Recebi";
    (el("sfMqTexto") as HTMLElement).textContent = [r.titulo, r.contraparte].filter(Boolean).join(" — ");
    (el("sfMqValorRot") as HTMLElement).textContent = "Quanto entrou? (R$)";
    setCampo("sfMqValor", valorParaCampo(num(r.valor_recebido) ?? r.valor_estimado));
    setCampo("sfMqData", txt(r.recebido_em).slice(0, 10) || hojeISO());
  }
  quitarCtx = { tipo, id };
  msgModal("sfMqMsg", "");
  modal.classList.add("open");
  window.setTimeout(() => (campo("sfMqValor") as HTMLInputElement | null)?.focus(), 50);
}
function sfFecharQuitar(): void { el("sfModalQuitar")?.classList.remove("open"); quitarCtx = null; }
async function sfConfirmarQuitar(): Promise<void> {
  const ctx = quitarCtx;
  if (!ctx) return;
  const v = lerValor(campo("sfMqValor")?.value || "");
  if (v != null && (Number.isNaN(v) || v < 0)) { msgModal("sfMqMsg", "Valor inválido. Use números, ex.: 1.234,56", true); return; }
  const data = (campo("sfMqData")?.value || "").trim() || hojeISO();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) { msgModal("sfMqMsg", "Data inválida.", true); return; }
  const valor = v == null ? null : Math.round(v * 100) / 100;
  if (ctx.tipo === "divida") {
    const d0 = D.dividas.find((x) => x.id === ctx.id);
    // dívida sem valor cadastrado: o que foi pago é o único número que sai da lista
    if (d0 && semValor(d0) && !(valor != null && valor > 0)) { msgModal("sfMqMsg", "Esta dívida não tem valor cadastrado: informe quanto pagou.", true); return; }
  }
  const btn = el("sfMqOk") as HTMLButtonElement | null;
  if (btn) btn.disabled = true;
  msgModal("sfMqMsg", "Salvando…");
  try {
    if (ctx.tipo === "divida") {
      const d0 = D.dividas.find((x) => x.id === ctx.id);
      if (!d0) { sfFecharQuitar(); return; }
      const dv = divisao(d0);
      const antes = pagoParcial(d0);
      const pagoAgora = valor ?? 0;
      let body: Record<string, unknown>;
      let parcial = false;
      if (dv.aVencer > 0) {
        // paga SÓ o vencido: a linha segue aberta com o a vencer (comprometido). valor_pago acumula o que já foi
        // pago do vencido; a proposta (era para o vencido) sai; a divisão gravada é a que a tela mostrava.
        parcial = true;
        body = {
          valor: 0, valor_proposta: null, valor_pago: r2(antes + pagoAgora), quitada_em: data,
          valor_a_vencer: dv.aVencer, proximo_vencimento: dv.proximo,
        };
      } else if (antes > 0) {
        // fim de uma linha que já tinha pagamentos do vencido: o que sai da lista é tudo o que foi vencendo
        const total = r2(dv.vencido + antes);
        body = { quitada: true, valor: total, valor_pago: r2(antes + pagoAgora), quitada_em: data, valor_a_vencer: 0, proximo_vencimento: null };
        tetoCompativel(d0, total, body);
      } else {
        body = { quitada: true, valor_pago: valor, quitada_em: data };
        // divisão calculada pela tela (em dia sem separar / vencimento que passou): grava o vencido que saiu da lista
        if (dv.estimado > 0 || emDiaSemSeparar(d0)) {
          Object.assign(body, { valor: dv.vencido, valor_a_vencer: 0, proximo_vencimento: null });
          tetoCompativel(d0, dv.vencido, body);
        }
      }
      const linha = await patchJson<Partial<SfDivida>>(`${API}/dividas/${encodeURIComponent(ctx.id)}`, body);
      const d = mesclar(D.dividas, ctx.id, body as Partial<SfDivida>, linha);
      sfFecharQuitar();
      if (d) renderTipo(d.grupo as Tipo);
      renderPainel();
      toast(parcial
        ? `Vencido pago! Fica só o a vencer (${fmtR(dv.aVencer)}), como despesa comprometida. Você já eliminou ${fmtR(statsTotal().eliminado)}.`
        : `Quitada! Você já eliminou ${fmtR(statsTotal().eliminado)}.`);
    } else {
      const body = { recebido: true, valor_recebido: valor, recebido_em: data };
      const linha = await patchJson<Partial<SfReaver>>(`${API}/reaver/${encodeURIComponent(ctx.id)}`, body);
      mesclar(D.reaver, ctx.id, body, linha);
      sfFecharQuitar();
      renderReaver();
      renderPainel();
      toast(`Recebido! Já voltaram ${fmtR(somaReaver().voltou)}.`);
    }
  } catch (e) {
    msgModal("sfMqMsg", e instanceof Error ? e.message : String(e), true);
  } finally {
    if (btn) btn.disabled = false;
  }
}
/** O valor (vencido) gravado não pode passar do teto (o servidor recusa): se passar, o teto sobe junto. */
function tetoCompativel(d: SfDivida, novoValor: number, body: Record<string, unknown>): void {
  const t = num(d.valor_teto);
  if (t != null && t < novoValor) body.valor_teto = novoValor;
}
async function desfazerQuitar(id: string): Promise<void> {
  const d = D.dividas.find((x) => x.id === id);
  if (!d || !window.confirm(`Voltar “${d.credor}” para em aberto?\n\nO pagamento anotado (${fmtR(pagoDe(d))}) é desfeito.`)) return;
  // em linha aberta, valor_pago é "já pago do vencido" (conta como eliminado): ao reabrir, o pagamento sai junto.
  // Vencido zerado com o valor guardado no pago (quitação antiga feita pela sincronização): o valor volta.
  const body: Record<string, unknown> = { quitada: false, valor_pago: null, quitada_em: null };
  if (num(d.valor) === 0 && n0(d.valor_pago) > 0) {
    body.valor = n0(d.valor_pago);
    tetoCompativel(d, n0(d.valor_pago), body);
  }
  try {
    const linha = await patchJson<Partial<SfDivida>>(`${API}/dividas/${encodeURIComponent(id)}`, body);
    mesclar(D.dividas, id, body as Partial<SfDivida>, linha);
    renderTipo(d.grupo as Tipo);
    renderPainel();
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), "erro");
  }
}
/** Desfaz o "✓ Paguei o vencido" de uma linha que segue aberta: o pago volta a contar como vencido. */
async function desfazerParcial(id: string): Promise<void> {
  const d = D.dividas.find((x) => x.id === id);
  const pp = d ? pagoParcial(d) : 0;
  if (!d || !(pp > 0)) return;
  const ligada = num(d.vobi_fornecedor_id) != null;
  const msg = ligada
    ? `Desfazer o pagamento do vencido de “${d.credor}” (${fmtR(pp)})?\n\nA linha é atualizada pela Vobi: o vencido volta no próximo “Atualizar da Vobi”, se ainda estiver em aberto lá.`
    : `Desfazer o pagamento do vencido de “${d.credor}” (${fmtR(pp)})?\n\nO valor volta a contar como vencido.`;
  if (!window.confirm(msg)) return;
  const body: Record<string, unknown> = { valor_pago: null, quitada_em: null };
  if (!ligada) {
    const novo = r2(Math.max(0, n0(d.valor)) + pp);
    body.valor = novo;
    tetoCompativel(d, novo, body);
  }
  try {
    const linha = await patchJson<Partial<SfDivida>>(`${API}/dividas/${encodeURIComponent(id)}`, body);
    mesclar(D.dividas, id, body as Partial<SfDivida>, linha);
    renderTipo(d.grupo as Tipo);
    renderPainel();
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), "erro");
  }
}
async function desfazerReceber(id: string): Promise<void> {
  const r = D.reaver.find((x) => x.id === id);
  if (!r || !window.confirm(`Voltar “${r.titulo}” para a reaver?`)) return;
  try {
    const linha = await patchJson<Partial<SfReaver>>(`${API}/reaver/${encodeURIComponent(id)}`, { recebido: false });
    mesclar(D.reaver, id, { recebido: false }, linha);
    renderReaver();
    renderPainel();
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), "erro");
  }
}

// ── despesa comprometida: "✗ Não vai acontecer" (corta) e desfazer ──
async function cortarComprometida(id: string, cortar: boolean): Promise<void> {
  const d = D.dividas.find((x) => x.id === id);
  if (!d || !D.podeEditar) return;
  const pergunta = cortar
    ? `“${d.credor}”: ${fmtR(aVencer(d))} a vencer não vai acontecer?\n\nSai do comprometido (fica riscada; dá para desfazer).`
    : `Desfazer o corte de “${d.credor}”? Volta a contar como despesa comprometida.`;
  if (!window.confirm(pergunta)) return;
  try {
    // sem data: o servidor grava cortada_em = hoje (São Paulo), ou mantém a que já existia
    const body = { comprometida_cortada: cortar };
    const linha = await patchJson<Partial<SfDivida>>(`${API}/dividas/${encodeURIComponent(id)}`, body);
    mesclar(D.dividas, id, cortar ? { comprometida_cortada: true, cortada_em: d.cortada_em || hojeISO() } : { comprometida_cortada: false }, linha);
    renderTipo(d.grupo as Tipo);
    renderPainel();
    if (cortar) toast(`Despesa cortada: −${fmtR(aVencer(d))} no comprometido.`);
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), "erro");
  }
}

// ── detalhes da dívida (modal) ──
const MD_CAMPOS = [
  "sfMdSituacao", "sfMdProposta", "sfMdPropObs", "sfMdPago", "sfMdQuitEm", "sfMdValor", "sfMdTeto",
  "sfMdAVencer", "sfMdProxVenc", "sfMdCobranca", "sfMdParcela", "sfMdRisco", "sfMdObs", "sfMdVobiId",
];
let mdSnap: Record<string, string> = {};
/** O modal abriu mostrando uma divisão CALCULADA pela tela (em dia sem separar, ou vencimento que já passou):
 *  qualquer gravação leva junto vencido + a vencer + próximo vencimento como foram mostrados — senão mudar só a
 *  situação (ou outro campo) faria o valor antigo voltar a contar inteiro como vencido. */
let mdDividido = false;
function textoVobi(idf: number | null): string {
  return idf != null
    ? `Ligada ao fornecedor nº ${idf} da Vobi: “Atualizar da Vobi” regrava o vencido, o a vencer e o próximo vencimento.`
    : "Só ligue a um fornecedor da Vobi se TODA a dívida desta linha estiver lançada lá: o “Atualizar da Vobi” passa a regravar o vencido e o a vencer com o que estiver em aberto na Vobi.";
}
async function sfEditarDivida(id: string): Promise<void> {
  await esperarPendente(`divida:${id}`); // proposta digitada na linha e ✎ tocado logo em seguida
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
  setCampo("sfMdId", d.id);
  setCampo("sfMdProposta", valorParaCampo(d.valor_proposta));
  setCampo("sfMdPropObs", d.proposta_obs || "");
  setCampo("sfMdPago", valorParaCampo(d.valor_pago));
  setCampo("sfMdQuitEm", txt(d.quitada_em).slice(0, 10));
  // divisão calculada pela tela (em dia sem separar: vencido 0 e tudo a vencer; vencimento que passou: o que
  // venceu foi para o vencido): o modal mostra exatamente o que a tela usa
  const dv = divisao(d);
  mdDividido = !d.quitada && (emDiaSemSeparar(d) || dv.estimado > 0);
  setCampo("sfMdValor", mdDividido ? valorParaCampo(dv.vencido) : valorParaCampo(d.valor));
  setCampo("sfMdTeto", valorParaCampo(d.valor_teto));
  setCampo("sfMdAVencer", mdDividido ? valorParaCampo(dv.aVencer) : valorParaCampo(d.valor_a_vencer));
  setCampo("sfMdProxVenc", mdDividido ? (dv.proximo || "") : (dataISO(d.proximo_vencimento) || ""));
  const aviso = el("sfMdAviso");
  if (aviso) {
    aviso.textContent = d.quitada ? ""
      : dv.estimado > 0 && dv.venceuEm
        ? `O próximo vencimento gravado (${fmtData(dv.venceuEm)}) já passou: a tela passou ${fmtR(dv.estimado)} do “a vencer” para o vencido (${num(d.parcela_mensal) ? "pela parcela por mês" : "tudo, por não haver parcela"}). Confira os valores abaixo e salve — ou use “Atualizar da Vobi”.`
        : emDiaSemSeparar(d)
          ? "Linha “em dia” sem o a vencer separado: tudo conta como a vencer (comprometido). Ao salvar, essa divisão é gravada."
          : dv.aVencer > 0 && !dv.proximo
            ? "Informe o próximo vencimento: sem ele a tela não sabe quando o comprometido vira vencido."
            : "";
  }
  setCampo("sfMdVobiId", d.vobi_fornecedor_id != null ? String(d.vobi_fornecedor_id) : "");
  const cobSel = campo("sfMdCobranca") as HTMLSelectElement | null;
  if (cobSel) {
    const auto = D.rotuloCobranca[cobrancaDerivada(d)] || cobrancaDerivada(d);
    cobSel.innerHTML = [`<option value="">Automática (pela situação: ${esc(auto.toLowerCase())})</option>`]
      .concat(D.cobrancas.map((c) => `<option value="${esc(c)}">${esc(D.rotuloCobranca[c] || c)}</option>`)).join("");
    cobSel.value = d.cobranca === "com_cobranca" || d.cobranca === "sem_cobranca" ? d.cobranca : "";
  }
  const vobiNota = el("sfMdVobi");
  if (vobiNota) vobiNota.textContent = textoVobi(num(d.vobi_fornecedor_id));
  setCampo("sfMdParcela", valorParaCampo(d.parcela_mensal));
  setCampo("sfMdRisco", d.risco || "");
  setCampo("sfMdObs", d.observacao || "");
  // quitada, ou aberta com o vencido já pago ("✓ Paguei o vencido"): mostra o valor pago e a data
  const qb = el("sfMdQuitBox");
  if (qb) qb.style.display = d.quitada || pagoParcial(d) > 0 ? "" : "none";
  const qt = el("sfMdQuitTit");
  if (qt) qt.textContent = d.quitada ? "✓ Quitada" : "✓ Vencido já pago (a linha segue com o a vencer)";
  const cred = el("sfMdCredor");
  if (cred) cred.textContent = [d.credor, d.identificacao].filter(Boolean).join(" — ") + (motivoFora(d) ? ` (${motivoFora(d)})` : "");
  modal.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input:not([type=hidden]), textarea, select")
    .forEach((c) => { c.disabled = !D.podeEditar; });
  msgModal("sfMdMsg", "");
  const salvar = el("sfMdSalvar") as HTMLButtonElement | null;
  if (salvar) salvar.disabled = !D.podeEditar;
  mdSnap = retrato(MD_CAMPOS);
  modal.classList.add("open");
}
function sfFecharDivida(): void { el("sfModalDivida")?.classList.remove("open"); }
async function sfSalvarDivida(): Promise<void> {
  const id = campo("sfMdId")?.value || "";
  const d = D.dividas.find((x) => x.id === id);
  if (!id || !d || !D.podeEditar) return;
  // só vai no PATCH o que mudou em relação ao que o modal mostrou ao abrir (não desfaz o que foi salvo na linha)
  const body: Record<string, unknown> = {};
  const nomes: Array<[string, string, string]> = [
    ["valor_proposta", "sfMdProposta", "Proposta de quitação"], ["valor", "sfMdValor", "Vencido"],
    ["valor_teto", "sfMdTeto", "Valor máximo"], ["valor_a_vencer", "sfMdAVencer", "A vencer"],
    ["parcela_mensal", "sfMdParcela", "Parcela por mês"],
  ];
  const temPago = d.quitada || pagoParcial(d) > 0;
  if (temPago) nomes.push(["valor_pago", "sfMdPago", "Valor pago"]);
  // divisão calculada pela tela (em dia sem separar / vencimento que passou): mudou QUALQUER campo (inclusive só a
  // situação) → grava vencido + a vencer + próximo vencimento como o modal mostrou (senão o valor antigo, que a tela
  // mostrava como a vencer, voltaria a contar inteiro como vencido)
  const gravarDivisao = mdDividido && MD_CAMPOS.some((c) => mudou(mdSnap, c));
  for (const [k, cid, rot] of nomes) {
    if (!mudou(mdSnap, cid) && !(gravarDivisao && (k === "valor" || k === "valor_a_vencer"))) continue;
    const v = lerValor(campo(cid)?.value || "");
    if (v != null && (Number.isNaN(v) || v < 0)) { msgModal("sfMdMsg", `${rot}: valor inválido. Use números, ex.: 1.234,56`, true); return; }
    body[k] = v == null ? null : Math.round(v * 100) / 100;
  }
  const textos: Array<[string, string]> = [["situacao", "sfMdSituacao"], ["proposta_obs", "sfMdPropObs"], ["risco", "sfMdRisco"], ["observacao", "sfMdObs"]];
  for (const [k, cid] of textos) if (mudou(mdSnap, cid)) body[k] = (campo(cid)?.value || "").trim() || null;
  const pvCampo = (campo("sfMdProxVenc")?.value || "").trim();
  if (pvCampo && !/^\d{4}-\d{2}-\d{2}$/.test(pvCampo)) { msgModal("sfMdMsg", "Próximo vencimento: data inválida.", true); return; }
  if (mudou(mdSnap, "sfMdProxVenc") || gravarDivisao) body.proximo_vencimento = pvCampo || null;
  // o que já venceu não é "a vencer": com a vencer > 0, o próximo vencimento não pode estar no passado
  if (!d.quitada && ("proximo_vencimento" in body || "valor_a_vencer" in body)) {
    const av = lerValor(campo("sfMdAVencer")?.value || "");
    if (pvCampo && pvCampo < hojeISO() && av != null && av > 0) {
      msgModal("sfMdMsg", `O próximo vencimento (${fmtData(pvCampo)}) já passou: o que venceu nessa data vai no campo “Vencido”. Informe a próxima data a vencer (ou deixe em branco).`, true);
      return;
    }
  }
  if (mudou(mdSnap, "sfMdCobranca")) body.cobranca = campo("sfMdCobranca")?.value || null;
  if (temPago && mudou(mdSnap, "sfMdQuitEm")) {
    const q = (campo("sfMdQuitEm")?.value || "").trim();
    if (q) body.quitada_em = q;
  }
  if (mudou(mdSnap, "sfMdVobiId")) {
    const s = (campo("sfMdVobiId")?.value || "").trim();
    if (!s) body.vobi_fornecedor_id = null;
    else if (/^\d{1,9}$/.test(s) && Number(s) > 0) body.vobi_fornecedor_id = Number(s);
    else { msgModal("sfMdMsg", "Fornecedor na Vobi: use só o número do cadastro (ex.: 665764), ou deixe vazio.", true); return; }
    if (body.vobi_fornecedor_id != null) {
      const outra = D.dividas.find((x) => x.id !== d.id && x.ativo !== false && !x.quitada && num(x.vobi_fornecedor_id) === body.vobi_fornecedor_id);
      if (outra && !window.confirm(`O fornecedor nº ${body.vobi_fornecedor_id} já está ligado a “${outra.credor}”. Com duas linhas no mesmo fornecedor, o “Atualizar da Vobi” pula as duas. Ligar mesmo assim?`)) return;
    }
  }
  if (!Object.keys(body).length) { sfFecharDivida(); return; } // nada mudou: fecha sem gravar
  const btn = el("sfMdSalvar") as HTMLButtonElement | null;
  if (btn) btn.disabled = true;
  msgModal("sfMdMsg", "Salvando…");
  try {
    const linha = await patchJson<Partial<SfDivida>>(`${API}/dividas/${encodeURIComponent(id)}`, body);
    mesclar(D.dividas, id, body as Partial<SfDivida>, linha);
    sfFecharDivida();
    renderTipo(d.grupo as Tipo);
    renderPainel();
  } catch (e) {
    msgModal("sfMdMsg", e instanceof Error ? e.message : String(e), true);
  } finally {
    if (btn) btn.disabled = !D.podeEditar;
  }
}

// ── A reaver: adicionar / detalhes / remover ──
const MR_CAMPOS = ["sfMrTipo", "sfMrChance", "sfMrTitulo2", "sfMrContra", "sfMrValor", "sfMrPrev", "sfMrSit", "sfMrFonte", "sfMrObs", "sfMrValRec", "sfMrRecEm"];
let mrSnap: Record<string, string> = {};
async function abrirReaver(id: string | null): Promise<void> {
  const modal = el("sfModalReaver");
  if (!modal) return;
  if (id) await esperarPendente(`reaver:${id}`); // valor/chance alterados na linha e ✎ tocado logo em seguida
  const r = id ? D.reaver.find((x) => x.id === id) : undefined;
  if (id && !r) return;
  if (!r && !D.podeEditar) return;
  const tipoSel = campo("sfMrTipo") as HTMLSelectElement | null;
  if (tipoSel) tipoSel.innerHTML = D.tiposReaver.map((t) => `<option value="${esc(t)}">${esc(D.rotuloTipoReaver[t] || t)}</option>`).join("");
  const chSel = campo("sfMrChance") as HTMLSelectElement | null;
  if (chSel) chSel.innerHTML = D.chances.map((c) => `<option value="${esc(c)}">${esc(D.rotuloChance[c] || c)}</option>`).join("");
  setCampo("sfMrId", r?.id || "");
  setCampo("sfMrTipo", r?.tipo || "processo");
  setCampo("sfMrChance", r?.chance || "nao_sei");
  setCampo("sfMrTitulo2", r?.titulo || "");
  setCampo("sfMrContra", r?.contraparte || "");
  setCampo("sfMrValor", valorParaCampo(r?.valor_estimado));
  setCampo("sfMrPrev", r?.previsao || "");
  setCampo("sfMrSit", r?.situacao || "");
  setCampo("sfMrFonte", r?.fonte || "");
  setCampo("sfMrObs", r?.observacao || "");
  setCampo("sfMrValRec", valorParaCampo(r?.valor_recebido));
  setCampo("sfMrRecEm", txt(r?.recebido_em).slice(0, 10));
  const rb = el("sfMrRecBox");
  if (rb) rb.style.display = r?.recebido ? "" : "none";
  (el("sfMrTitulo") as HTMLElement).textContent = r ? "A reaver" : "Adicionar a reaver";
  modal.querySelector(".sf-modal")?.classList.toggle("sf-modal-novo", !r);
  modal.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input:not([type=hidden]), textarea, select")
    .forEach((c) => { c.disabled = !D.podeEditar; });
  msgModal("sfMrMsg", "");
  mrSnap = retrato(MR_CAMPOS);
  modal.classList.add("open");
  if (!r) window.setTimeout(() => (campo("sfMrTitulo2") as HTMLInputElement | null)?.focus(), 50);
}
function sfFecharReaver(): void { el("sfModalReaver")?.classList.remove("open"); }
async function sfSalvarReaver(): Promise<void> {
  if (!D.podeEditar) return;
  const id = campo("sfMrId")?.value || "";
  const r = id ? D.reaver.find((x) => x.id === id) : undefined;
  const titulo = (campo("sfMrTitulo2")?.value || "").trim();
  if (!titulo) { msgModal("sfMrMsg", "Informe o título.", true); return; }
  const v = lerValor(campo("sfMrValor")?.value || "");
  if (v != null && (Number.isNaN(v) || v < 0)) { msgModal("sfMrMsg", "Valor estimado inválido. Use números, ex.: 1.234,56", true); return; }
  const todos: Record<string, unknown> = {
    tipo: campo("sfMrTipo")?.value || "outro",
    titulo,
    contraparte: (campo("sfMrContra")?.value || "").trim() || null,
    valor_estimado: v == null ? null : Math.round(v * 100) / 100,
    chance: campo("sfMrChance")?.value || null,
    previsao: (campo("sfMrPrev")?.value || "").trim() || null,
  };
  let body: Record<string, unknown> = todos;
  if (r) {
    // edição: só o que mudou em relação ao que o modal mostrou ao abrir (não desfaz o que foi salvo na linha)
    body = {};
    const mapa: Array<[string, string]> = [["tipo", "sfMrTipo"], ["titulo", "sfMrTitulo2"], ["contraparte", "sfMrContra"], ["valor_estimado", "sfMrValor"], ["chance", "sfMrChance"], ["previsao", "sfMrPrev"]];
    for (const [k, cid] of mapa) if (mudou(mrSnap, cid)) body[k] = todos[k];
    const textos: Array<[string, string]> = [["situacao", "sfMrSit"], ["fonte", "sfMrFonte"], ["observacao", "sfMrObs"]];
    for (const [k, cid] of textos) if (mudou(mrSnap, cid)) body[k] = (campo(cid)?.value || "").trim() || null;
    if (r.recebido) {
      if (mudou(mrSnap, "sfMrValRec")) {
        const vr = lerValor(campo("sfMrValRec")?.value || "");
        if (vr != null && (Number.isNaN(vr) || vr < 0)) { msgModal("sfMrMsg", "Valor recebido inválido.", true); return; }
        body.valor_recebido = vr == null ? null : Math.round(vr * 100) / 100;
      }
      const re = (campo("sfMrRecEm")?.value || "").trim();
      if (re && mudou(mrSnap, "sfMrRecEm")) body.recebido_em = re;
    }
    if (!Object.keys(body).length) { sfFecharReaver(); return; } // nada mudou: fecha sem gravar
  }
  const btn = el("sfMrSalvar") as HTMLButtonElement | null;
  if (btn) btn.disabled = true;
  msgModal("sfMrMsg", "Salvando…");
  try {
    if (r) {
      const linha = await patchJson<Partial<SfReaver>>(`${API}/reaver/${encodeURIComponent(r.id)}`, body);
      mesclar(D.reaver, r.id, body as Partial<SfReaver>, linha);
    } else {
      const linha = await enviarJson<SfReaver>("POST", `${API}/reaver`, body);
      if (linha && typeof linha === "object" && linha.id) D.reaver.push({ ...linha, ativo: true, recebido: linha.recebido === true });
      toast(`Incluído em A reaver: ${titulo}`);
    }
    sfFecharReaver();
    renderReaver();
    renderPainel();
  } catch (e) {
    msgModal("sfMrMsg", e instanceof Error ? e.message : String(e), true);
  } finally {
    if (btn) btn.disabled = false;
  }
}
async function sfRemoverReaver(): Promise<void> {
  const id = campo("sfMrId")?.value || "";
  const r = D.reaver.find((x) => x.id === id);
  if (!r || !D.podeEditar) return;
  if (!window.confirm(`Remover “${r.titulo}” da lista A reaver?`)) return;
  try {
    await enviarJson("DELETE", `${API}/reaver/${encodeURIComponent(id)}`, {});
    D.reaver = D.reaver.filter((x) => x.id !== id);
    sfFecharReaver();
    renderReaver();
    renderPainel();
  } catch (e) {
    msgModal("sfMrMsg", e instanceof Error ? e.message : String(e), true);
  }
}

// ───────────────────────── abas ─────────────────────────
const ABAS = ["painel", "impostos", "bancos", "fornecedores", "outras", "reaver", "plano", "protestos"];
/** Abas da versão anterior guardadas no navegador caem no Painel. */
function ativarAba(tab: string): void {
  const t = ABAS.includes(tab) ? tab : "painel";
  document.querySelectorAll<HTMLElement>("#sfPills .pill").forEach((p) => p.classList.toggle("active", p.dataset.tab === t));
  document.querySelectorAll<HTMLElement>("section[data-sec]").forEach((s) => { s.style.display = s.dataset.sec === t ? "" : "none"; });
  lsSet("sf:aba", t);
  // no celular as abas rolam de lado: traz a aba ativa para a área visível (só a faixa rola, não a página)
  const faixa = el("sfPills");
  const pill = faixa?.querySelector<HTMLElement>(`.pill[data-tab="${t}"]`);
  if (faixa && pill && faixa.scrollWidth > faixa.clientWidth) {
    const fr = faixa.getBoundingClientRect(), pr = pill.getBoundingClientRect();
    if (pr.left < fr.left || pr.right > fr.right) faixa.scrollLeft += (pr.left - fr.left) - (fr.width - pr.width) / 2;
  }
}
function sfTab(btn: HTMLElement): void { ativarAba(btn.dataset.tab || "painel"); }

// ───────────────────────── eventos (delegação) ─────────────────────────
function aoAcionar(t: HTMLElement): void {
  const act = t.dataset.sfAct;
  const id = t.dataset.id || "";
  if (act === "ir-aba") { ativarAba(t.dataset.aba || "painel"); window.scrollTo({ top: 0, behavior: "smooth" }); }
  else if (act === "quitar") void abrirQuitar("divida", id);
  else if (act === "desfazer-quitar") void desfazerQuitar(id);
  else if (act === "desfazer-parcial") void desfazerParcial(id);
  else if (act === "cortar-comp") void cortarComprometida(id, true);
  else if (act === "descortar-comp") void cortarComprometida(id, false);
  else if (act === "editar-divida") void sfEditarDivida(id);
  else if (act === "receber") void abrirQuitar("reaver", id);
  else if (act === "desfazer-receber") void desfazerReceber(id);
  else if (act === "editar-reaver") void abrirReaver(id);
  else if (act === "novo-reaver") void abrirReaver(null);
  else if (act === "salvar-prot") void sfSalvarProtesto(id);
  else if (act === "cancelar-prot") void marcarProtesto(id, true);
  else if (act === "desfazer-prot") void marcarProtesto(id, false);
  else if (act === "ver-v1") { verV1 = !verV1; renderPlano(); }
}
document.addEventListener("click", (e) => {
  const t = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-sf-act]");
  if (t) aoAcionar(t);
});
document.addEventListener("change", (e) => {
  const a = e.target as HTMLElement | null;
  if (!a || !a.dataset) return;
  // registradas como pendentes: o ✎ / "✓ Quitei" da mesma linha esperam a gravação terminar
  if (a.dataset.propId) registrarPendente(`divida:${a.dataset.propId}`, salvarProposta(a as HTMLInputElement));
  else if (a.dataset.reaverValor) registrarPendente(`reaver:${a.dataset.reaverValor}`, salvarValorReaver(a as HTMLInputElement));
  else if (a.dataset.reaverChance) registrarPendente(`reaver:${a.dataset.reaverChance}`, salvarChanceReaver(a as HTMLSelectElement));
  else if (a.dataset.acaoStatus) void salvarStatusAcao(a as HTMLSelectElement);
  else if (a.dataset.acaoVendido) void salvarVendidoAcao(a as HTMLInputElement);
  else if (a.hasAttribute("data-sf-prazo")) {
    const v = Number((a as HTMLSelectElement).value);
    if (PRAZOS.includes(v)) { prazo = v; lsSet("sf:prazo", String(v)); renderPainel(); for (const t of TIPOS) renderCabecalhoTipo(t); }
  } else {
    const k = a.dataset.sfF;
    if (k === "protGrupo" || k === "protTab") {
      filtros[k] = (a as HTMLSelectElement).value;
      salvarFiltros();
      renderProtLista();
    }
  }
});
document.addEventListener("input", (e) => {
  const a = e.target as HTMLElement | null;
  if (!a || !a.dataset) return;
  if (a.dataset.sfF === "protBusca") {
    filtros.protBusca = (a as HTMLInputElement).value;
    salvarFiltros();
    renderProtLista();
  } else if (a.dataset.protId) {
    const pid = a.dataset.protId;
    rascProt[pid] = (a as HTMLTextAreaElement).value;
    delete msgProt[pid];
    const m = document.querySelector<HTMLElement>(`[data-msg-prot="${CSS.escape(pid)}"]`);
    if (m) { m.className = "sf-msg"; m.textContent = "Não salvo"; }
  } else if (a.classList.contains("sf-in")) {
    a.classList.remove("sf-erro");
  }
});
// toggle não borbulha: escuta na captura para lembrar quais grupos ficaram abertos
document.addEventListener("toggle", (e) => {
  const d = e.target;
  if (d instanceof HTMLDetailsElement && d.dataset.det) detAberto.set(d.dataset.det, d.open);
}, true);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (el("sfModalQuitar")?.classList.contains("open")) { sfFecharQuitar(); return; }
    if (el("sfModalReaver")?.classList.contains("open")) { sfFecharReaver(); return; }
    if (el("sfModalDivida")?.classList.contains("open")) { sfFecharDivida(); return; }
  }
  if (e.key === "Enter") {
    const a = e.target as HTMLElement | null;
    // Enter num campo de valor da lista = salvar (o "change" dispara ao sair do campo)
    if (a && a.tagName === "INPUT" && a.classList.contains("sf-in")) { e.preventDefault(); (a as HTMLInputElement).blur(); }
  }
});

// handlers usados nos onclick do HTML (o módulo não cria globais sozinho)
Object.assign(window, {
  sfTab, sfAtualizarVobi, sfSalvarProtesto,
  sfEditarDivida, sfFecharDivida, sfSalvarDivida,
  sfFecharQuitar, sfConfirmarQuitar,
  sfFecharReaver, sfSalvarReaver, sfRemoverReaver,
});

// ───────────────────────── início ─────────────────────────
ativarAba(lsGet("sf:aba") || "painel");
renderPainel();
renderTipos();
renderReaver();
renderPlano();
renderProtestos();
void carregarVivo(false);
