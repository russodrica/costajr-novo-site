// Integração AO VIVO (somente leitura) com a API Vobi v2.
// Auth HTTP Basic -> Bearer (token ~5min). Indicadores de Financeiro e Comercial.
// Credenciais: VOBI_UUID / VOBI_SECRET (no .env local e nas env vars da Vercel).
// Cache em memória por instância (TTL 5min) para não marretar a Vobi a cada request.

const VOBI = "https://api.vobi.com.br/v2";

function creds() {
  const uuid = process.env.VOBI_UUID ?? import.meta.env.VOBI_UUID;
  const secret = process.env.VOBI_SECRET ?? import.meta.env.VOBI_SECRET;
  return { uuid, secret };
}
export function vobiConfigurado(): boolean {
  const { uuid, secret } = creds();
  return !!(uuid && secret);
}

let _token: string | null = null;
let _tokenAt = 0;
async function token(): Promise<string> {
  if (_token && Date.now() - _tokenAt < 4 * 60 * 1000) return _token;
  const { uuid, secret } = creds();
  if (!uuid || !secret) throw Object.assign(new Error("Credenciais da Vobi (VOBI_UUID/VOBI_SECRET) não configuradas."), { vobiConfig: true });
  const basic = Buffer.from(`${uuid}:${secret}`).toString("base64");
  const r = await fetch(`${VOBI}/auth/token`, { method: "POST", headers: { authorization: `Basic ${basic}` } });
  if (!r.ok) throw new Error(`Autenticação na Vobi falhou (HTTP ${r.status}).`);
  const j: any = await r.json();
  _token = j.jwt || j.token;
  _tokenAt = Date.now();
  if (!_token) throw new Error("Token da Vobi não retornado.");
  return _token;
}

async function getJson(path: string): Promise<any> {
  const t = await token();
  const r = await fetch(`${VOBI}${path}`, { headers: { authorization: `Bearer ${t}` } });
  if (!r.ok) throw new Error(`Vobi GET ${path}: HTTP ${r.status}`);
  return r.json();
}
/** Pagina um endpoint de listagem (limit 500). Cap de segurança em 80 páginas. */
async function getAll(endpoint: string, extra = ""): Promise<any[]> {
  const out: any[] = [];
  let offset = 0;
  for (let p = 0; p < 80; p++) {
    const j = await getJson(`/${endpoint}?limit=500&offset=${offset}${extra}`);
    const rows = j?.rows || j?.data || (Array.isArray(j) ? j : []);
    out.push(...rows);
    if (rows.length < 500) break;
    offset += 500;
  }
  return out;
}

const _cache = new Map<string, { at: number; data: any }>();
async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data as T;
  const data = await fn();
  _cache.set(key, { at: Date.now(), data });
  return data;
}

const n = (v: any) => Number(v) || 0;
const MESES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MES_LABEL = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

// ──────────────────────────────── FINANCEIRO ────────────────────────────────

export type FinResumo = { total: number; qtd: number; vencido: number; vencidoQtd: number; aVencer: number; aVencerQtd: number };
export type VobiFinanceiro = {
  ano: number;
  meses: { mes: string; entradas: number; entradasPrev: number; saidas: number; saidasPrev: number; resultado: number }[];
  totais: { entradas: number; saidas: number; resultado: number; entradasPrev: number; saidasPrev: number };
  pagar: FinResumo & { vencidoGeral: number; vencidoGeralQtd: number };
  receber: FinResumo & { vencidoGeral: number; vencidoGeralQtd: number };
};

export async function vobiFinanceiro(ano: number): Promise<VobiFinanceiro> {
  return cached(`fin-${ano}`, 5 * 60 * 1000, async () => {
    // 1) Fluxo de caixa do ano (previsto x realizado por mês)
    const cf = await getJson(`/financial/cashFlow?where[year]=${ano}`);
    const rows: any[] = (cf?.foreseenAccomplished || []).filter(Boolean);
    const byType = (t: string) => rows.find((r) => r.type === t) || {};
    const inc = byType("incomeTotal"), exp = byType("expenseTotal"), res = byType("result");
    const meses = MESES.map((m, i) => ({
      mes: MES_LABEL[i],
      entradas: Math.abs(n(inc[m])),
      entradasPrev: Math.abs(n(inc[m + "Foreseen"])),
      saidas: Math.abs(n(exp[m])),
      saidasPrev: Math.abs(n(exp[m + "Foreseen"])),
      resultado: n(res[m]),
    }));
    const totais = {
      entradas: Math.abs(n(inc.total)), saidas: Math.abs(n(exp.total)), resultado: n(res.total),
      entradasPrev: Math.abs(n(inc.totalForeseen)), saidasPrev: Math.abs(n(exp.totalForeseen)),
    };

    // 2) Parcelas em aberto (idInstallmentStatus = 1 = previsto/não pago), a pagar e a receber
    const [desp, rec] = await Promise.all([
      getAll("installment", `&where[idInstallmentStatus]=1&where[$payment.billType$]=expense`),
      getAll("installment", `&where[idInstallmentStatus]=1&where[$payment.billType$]=income`),
    ]);
    const hoje = new Date().toISOString().slice(0, 10);
    const val = (i: any) => n(i.price ?? i.originalValue);
    const soma = (a: any[]) => a.reduce((t, i) => t + val(i), 0);
    const doAno = (i: any) => (i.dueDate || "").slice(0, 4) === String(ano);
    function resumo(list: any[]) {
      const arr = list.filter(doAno);
      const venc = arr.filter((i) => (i.dueDate || "").slice(0, 10) < hoje);
      const fut = arr.filter((i) => (i.dueDate || "").slice(0, 10) >= hoje);
      // vencido GERAL (todos os anos) = passivo/ativo em aberto de fato, hoje
      const vencGeral = list.filter((i) => (i.dueDate || "").slice(0, 10) < hoje);
      return {
        total: soma(arr), qtd: arr.length,
        vencido: soma(venc), vencidoQtd: venc.length,
        aVencer: soma(fut), aVencerQtd: fut.length,
        vencidoGeral: soma(vencGeral), vencidoGeralQtd: vencGeral.length,
      };
    }
    return { ano, meses, totais, pagar: resumo(desp), receber: resumo(rec) };
  });
}

// ──────────────────────────────── COMERCIAL ─────────────────────────────────

export type Bucket = { n: number; valor: number };
export type VobiComercial = {
  ano: number | null;
  totalOportunidades: number;
  totalValor: number;
  ganhas: Bucket;
  perdidas: Bucket;
  canceladas: Bucket;
  aberto: Bucket;
  conversao: number; // % ganhas / (ganhas + perdidas)
  funil: { nome: string; cor: string; n: number; valor: number }[];
};

export async function vobiComercial(ano: number | null): Promise<VobiComercial> {
  return cached(`com-${ano ?? "all"}`, 5 * 60 * 1000, async () => {
    const steps = await getAll("step");
    const nome = new Map<number, string>(steps.map((s) => [s.id, s.name]));
    const cor = new Map<number, string>(steps.map((s) => [s.id, s.color || "#94A3B8"]));
    const lostIds = steps.filter((s) => /perdid/i.test(s.name || "")).map((s) => s.id);
    const cancelIds = steps.filter((s) => /cancelad/i.test(s.name || "")).map((s) => s.id);
    const lostSet = new Set(lostIds), cancelSet = new Set(cancelIds);

    // pipeline padrão (a Vobi exclui perdidas/canceladas do fetch default) + as perdidas/canceladas por step
    const abertasRaw = await getAll("refurbish");
    const lostRaw: any[] = [], cancelRaw: any[] = [];
    for (const id of lostIds) lostRaw.push(...(await getAll("refurbish", `&where[idStep]=${id}`)));
    for (const id of cancelIds) cancelRaw.push(...(await getAll("refurbish", `&where[idStep]=${id}`)));

    const seen = new Set<number>();
    const todas: any[] = [];
    for (const r of [...abertasRaw, ...lostRaw, ...cancelRaw]) if (!seen.has(r.id)) { seen.add(r.id); todas.push(r); }

    const doAno = (r: any) => ano == null || (r.createdAt || r.creationDate || "").slice(0, 4) === String(ano);
    const valor = (r: any) => n(r.budget ?? r.total);
    const filtradas = todas.filter(doAno);

    const z = (): Bucket => ({ n: 0, valor: 0 });
    const ganhas = z(), perdidas = z(), canceladas = z(), aberto = z();
    const funilMap = new Map<number, { nome: string; cor: string; n: number; valor: number }>();
    for (const r of filtradas) {
      const v = valor(r);
      const sid = r.idStep ?? 0;
      const f = funilMap.get(sid) || { nome: nome.get(sid) || "Sem etapa", cor: cor.get(sid) || "#94A3B8", n: 0, valor: 0 };
      f.n++; f.valor += v; funilMap.set(sid, f);
      let b: Bucket;
      if (r.winnerDate) b = ganhas;
      else if (lostSet.has(r.idStep)) b = perdidas;
      else if (cancelSet.has(r.idStep)) b = canceladas;
      else b = aberto;
      b.n++; b.valor += v;
    }
    const funil = [...funilMap.values()].sort((a, b) => b.valor - a.valor);
    const dec = ganhas.n + perdidas.n;
    const conversao = dec ? Math.round((ganhas.n / dec) * 100) : 0;
    return {
      ano, totalOportunidades: filtradas.length, totalValor: filtradas.reduce((t, r) => t + valor(r), 0),
      ganhas, perdidas, canceladas, aberto, conversao, funil,
    };
  });
}
