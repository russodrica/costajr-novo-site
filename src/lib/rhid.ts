// ════════════════════════════════════════════════════════════════════════
// Integração com a API oficial do RHiD (Control iD) — controle de ponto.
//
// Base: https://rhid.com.br/v2/api.svc   (Swagger: /v2/swagger.svc/)
// Auth: POST /login { email, password, domain? } -> { accessToken }
//       Demais endpoints exigem header  Authorization: <accessToken>.
//
// Usado pelos endpoints /api/integra/rhid-entrada e /api/integra/rhid-saida
// para gerar os alertas de ponto no Telegram (grupo CJR Ativos).
//
// As batidas vêm do AFD (arquivo legal padronizado), baixado POR equipamento
// (idEquipamento). Isso já entrega de qual relógio/obra (ou app) cada batida
// veio — serve tanto para os alertas quanto para a auditoria de local.
//
// Tudo aqui é defensivo: variações de formato (AFD 1510 x 671) e de envelope
// de resposta são tratadas. Sem credenciais (RHID_EMAIL/RHID_SENHA), as
// funções lançam um erro claro e os endpoints respondem 503.
// ════════════════════════════════════════════════════════════════════════

function env(name: string): string {
  return (import.meta.env as any)[name] || (process.env as any)[name] || "";
}

const BASE = (env("RHID_BASE") || "https://rhid.com.br/v2/api.svc").replace(/\/+$/, "");
const EMAIL = env("RHID_EMAIL");
const SENHA = env("RHID_SENHA");
const DOMINIO = env("RHID_DOMINIO"); // opcional (multi-cliente)

export function rhidConfigurado(): boolean {
  return !!EMAIL && !!SENHA;
}

// ─── Autenticação (token em cache de processo) ──────────────────────────────
let _token = "";
let _tokenExp = 0;

async function obterToken(): Promise<string> {
  if (_token && Date.now() < _tokenExp) return _token;
  if (!rhidConfigurado()) throw new Error("Credenciais do RHiD ausentes (defina RHID_EMAIL e RHID_SENHA).");
  const body: Record<string, string> = { email: EMAIL, password: SENHA };
  if (DOMINIO) body.domain = DOMINIO;
  const r = await fetch(`${BASE}/login`, {
    method: "POST",
    headers: { "content-type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const j: any = await r.json().catch(() => ({}));
  const tok = j?.accessToken || j?.access_token || j?.token || "";
  if (!r.ok || !tok) {
    throw new Error(`Falha no login do RHiD (${r.status}): ${j?.error || j?.message || "sem accessToken na resposta"}`);
  }
  _token = String(tok);
  _tokenExp = Date.now() + 45 * 60 * 1000; // renova a cada ~45 min
  return _token;
}

// ─── GET genérico autenticado ───────────────────────────────────────────────
async function apiGet(path: string, params: Record<string, any> = {}, asText = false): Promise<any> {
  const tok = await obterToken();
  const u = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
  const r = await fetch(u.toString(), { headers: { Authorization: tok, Accept: asText ? "text/plain, */*" : "application/json" } });
  if (r.status === 401) {
    // token pode ter expirado entre as chamadas — renova uma vez
    _token = ""; _tokenExp = 0;
    const tok2 = await obterToken();
    const r2 = await fetch(u.toString(), { headers: { Authorization: tok2, Accept: asText ? "text/plain, */*" : "application/json" } });
    if (!r2.ok) throw new Error(`RHiD GET ${path} -> ${r2.status}`);
    return asText ? r2.text() : r2.json().catch(() => null);
  }
  if (!r.ok) throw new Error(`RHiD GET ${path} -> ${r.status}`);
  return asText ? r.text() : r.json().catch(() => null);
}

// Extrai um array de uma resposta que pode vir em vários envelopes diferentes.
function comoLista(j: any): any[] {
  if (Array.isArray(j)) return j;
  if (!j || typeof j !== "object") return [];
  for (const k of ["success", "data", "list", "persons", "people", "devices", "result", "results", "items"]) {
    if (Array.isArray(j[k])) return j[k];
  }
  // último recurso: primeiro valor que for array
  const arr = Object.values(j).find((v) => Array.isArray(v));
  return (arr as any[]) || [];
}

// ─── Funcionários ───────────────────────────────────────────────────────────
export type Pessoa = {
  id: number;
  nome: string;
  pis: string;        // só dígitos (chave para casar com o AFD)
  cpf: string;
  matricula: string;
  idDepartamento: number | null;
  statusRaw: any;     // status cru do RHiD (calibrar via diag)
  ativo: boolean;
};

// status do RHiD: 0 = ativo / 1 = demitido (confirmado via diag; ver pessoaAtiva)
function pessoaAtiva(statusRaw: any): boolean {
  const s = Number(statusRaw);
  if (Number.isNaN(s)) {
    const t = String(statusRaw || "").toLowerCase();
    return !(t.includes("demit") || t.includes("inativ") || t.includes("deslig"));
  }
  return s === 0; // 0 = ativo
}

const soDigitos = (v: any): string => String(v ?? "").replace(/\D/g, "");

export async function listarPessoas(): Promise<Pessoa[]> {
  const j = await apiGet("/person", { start: 0, length: 5000 });
  return comoLista(j).map((p: any) => ({
    id: Number(p.id),
    nome: String(p.name ?? p.nome ?? "").trim(),
    pis: soDigitos(p.pis),
    cpf: soDigitos(p.cpf),
    matricula: String(p.registration ?? p.matricula ?? "").trim(),
    idDepartamento: p.idDepartment != null ? Number(p.idDepartment) : null,
    statusRaw: p.status,
    ativo: pessoaAtiva(p.status),
  }));
}

// ─── Equipamentos (relógios + app) ──────────────────────────────────────────
export type Equipamento = { id: number; nome: string };

export async function listarEquipamentos(): Promise<Equipamento[]> {
  const j = await apiGet("/device", { start: 0, length: 1000 });
  return comoLista(j)
    .map((d: any) => ({
      id: Number(d.id ?? d.idDevice ?? d.deviceId),
      nome: String(d.name ?? d.description ?? d.nome ?? d.alias ?? `Equip. ${d.id}`).trim(),
    }))
    .filter((d) => Number.isFinite(d.id));
}

// ─── AFD (batidas) ──────────────────────────────────────────────────────────
export type Batida = { pis: string; ts: Date; nsr: string; deviceId: number; deviceNome: string };

// Baixa o AFD de um equipamento no intervalo (datas em ISO yyyy-mm-dd).
async function baixarAfd(idEquipamento: number, dataIni: string, dataFinal: string): Promise<string> {
  const txt = await apiGet("/report/afd/download", { idEquipamento, dataIni, dataFinal, limit: 100000 }, true);
  return typeof txt === "string" ? txt : String(txt ?? "");
}

// Parser de AFD tolerante: lê registros de marcação (tipo 3).
//  - Portaria 1510:  NSR(9) + "3" + ddmmaaaa(8) + hhmm(4) + PIS(12)
//  - Portaria 671:   NSR(9) + tipo + ... data ISO (aaaa-mm-ddThh:mm:ss) + PIS/CPF
// Retorna { pis, ts } por marcação (sem o equipamento — preenchido por quem chama).
export function parseAfd(texto: string): { pis: string; ts: Date; nsr: string }[] {
  const out: { pis: string; ts: Date; nsr: string }[] = [];
  if (!texto) return out;
  const linhas = texto.split(/\r?\n/);
  for (const linha of linhas) {
    const l = linha.trim();
    if (l.length < 20) continue;

    // 1510: 9 dígitos NSR + '3' + ddmmaaaa + hhmm + 12 dígitos PIS
    let m = l.match(/^(\d{9})3(\d{2})(\d{2})(\d{4})(\d{2})(\d{2})(\d{10,12})/);
    if (m) {
      const [, nsr, dd, mm, yyyy, hh, mi, pis] = m;
      // AFD traz horário LOCAL (relógio de parede). Guardamos como UTC com os
      // mesmos números e SEMPRE formatamos em UTC -> nada de deslocar 3h/trocar dia.
      const ts = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(mi)));
      if (!Number.isNaN(ts.getTime())) out.push({ pis: pis.replace(/^0+(?=\d)/, ""), ts, nsr });
      continue;
    }

    // 671 / variações com data ISO na linha
    const iso = l.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (iso) {
      const tipoChar = l.charAt(9); // tipo de registro logo após o NSR
      if (tipoChar && tipoChar !== "3" && tipoChar !== "7") continue; // 3/7 = marcação
      const [, yyyy, mm, dd, hh, mi, ss] = iso;
      const ts = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(mi), Number(ss || 0)));
      const nsr = (l.match(/^(\d{1,9})/) || [, ""])[1] as string;
      // PIS = último grupo de 11-12 dígitos na linha (NSR tem <=9; o offset de
      // fuso -03:00 não forma 11+; a data ISO também não). Evita pegar lixo.
      const grupos = [...l.matchAll(/\d{11,12}/g)].map((g) => g[0]);
      const pis = grupos.length ? grupos[grupos.length - 1].replace(/^0+(?=\d)/, "") : "";
      if (!Number.isNaN(ts.getTime())) out.push({ pis, ts, nsr });
      continue;
    }
  }
  return out;
}

// Coleta TODAS as batidas do dia (varre todos os equipamentos), já com o
// equipamento de origem de cada batida.
export async function coletarBatidasDoDia(dataISO: string, equipamentos?: Equipamento[]): Promise<Batida[]> {
  const equips = equipamentos || (await listarEquipamentos());
  const todas: Batida[] = [];
  for (const eq of equips) {
    let texto = "";
    try {
      texto = await baixarAfd(eq.id, dataISO, dataISO);
    } catch {
      continue; // equipamento sem AFD / sem acesso — ignora
    }
    for (const r of parseAfd(texto)) {
      // mantém só as batidas do dia pedido (o AFD pode trazer borda do intervalo)
      if (fmtDataISO(r.ts) !== dataISO) continue;
      todas.push({ ...r, deviceId: eq.id, deviceNome: eq.nome });
    }
  }
  return todas;
}

// ─── Datas / fuso (America/Sao_Paulo) ───────────────────────────────────────
export function fmtDataISO(d: Date): string {
  // Data (yyyy-mm-dd) do relógio de parede. Batidas são construídas via Date.UTC
  // com os números locais, então formatamos em UTC para devolver o dia local exato.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
export function agoraSP(): { iso: string; hora: number; minuto: number; diaSemana: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  const iso = `${parts.year}-${parts.month}-${parts.day}`;
  const mapDia: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { iso, hora: Number(parts.hour), minuto: Number(parts.minute), diaSemana: mapDia[parts.weekday as string] ?? new Date().getDay() };
}
function hhmm(d: Date): string {
  // mesmo princípio do fmtDataISO: batidas são UTC-wall, formatamos em UTC.
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}

// ─── Montagem do "dia" (pessoas ativas + batidas agrupadas por pessoa) ───────
export type BatidaPessoa = { ts: Date; deviceId: number; deviceNome: string };
export type DiaPonto = {
  dataISO: string;
  pessoasAtivas: Pessoa[];
  porPessoa: Map<number, BatidaPessoa[]>; // idPessoa -> batidas ordenadas
  semPisNoAfd: number;                     // batidas cujo PIS não casou com pessoa
};

export async function montarDia(dataISO: string): Promise<DiaPonto> {
  const [pessoas, equips] = await Promise.all([listarPessoas(), listarEquipamentos()]);
  const ativas = pessoas.filter((p) => p.ativo);
  const porPis = new Map<string, Pessoa>();
  for (const p of pessoas) if (p.pis) porPis.set(p.pis, p);

  const batidas = await coletarBatidasDoDia(dataISO, equips);
  const porPessoa = new Map<number, BatidaPessoa[]>();
  let semPis = 0;
  for (const b of batidas) {
    const pessoa = porPis.get(b.pis);
    if (!pessoa) { semPis++; continue; }
    const arr = porPessoa.get(pessoa.id) || [];
    arr.push({ ts: b.ts, deviceId: b.deviceId, deviceNome: b.deviceNome });
    porPessoa.set(pessoa.id, arr);
  }
  for (const arr of porPessoa.values()) arr.sort((a, b) => a.ts.getTime() - b.ts.getTime());

  return { dataISO, pessoasAtivas: ativas, porPessoa, semPisNoAfd: semPis };
}

// ─── Relatórios de negócio ──────────────────────────────────────────────────

// ENTRADA: ativos que ainda não têm nenhuma batida no dia.
export function relatorioEntrada(dia: DiaPonto): { semEntrada: Pessoa[]; comEntrada: Pessoa[] } {
  const semEntrada: Pessoa[] = [];
  const comEntrada: Pessoa[] = [];
  for (const p of dia.pessoasAtivas) {
    const tem = (dia.porPessoa.get(p.id) || []).length > 0;
    (tem ? comEntrada : semEntrada).push(p);
  }
  return { semEntrada, comEntrada };
}

// SAÍDA: quem já registrou saída (nº par de batidas) x quem está em aberto
// (entrou mas tem nº ímpar de batidas = última é entrada, falta a saída).
export function relatorioSaida(dia: DiaPonto): { bateuSaida: { p: Pessoa; ultima: string }[]; semSaida: { p: Pessoa; desde: string }[] } {
  const bateuSaida: { p: Pessoa; ultima: string }[] = [];
  const semSaida: { p: Pessoa; desde: string }[] = [];
  for (const p of dia.pessoasAtivas) {
    const bs = dia.porPessoa.get(p.id) || [];
    if (bs.length === 0) continue; // nem entrou — é assunto do alerta de entrada
    if (bs.length % 2 === 0) bateuSaida.push({ p, ultima: hhmm(bs[bs.length - 1].ts) });
    else semSaida.push({ p, desde: hhmm(bs[bs.length - 1].ts) });
  }
  return { bateuSaida, semSaida };
}

// AUDITORIA DE LOCAL: pessoa cujas batidas do dia vieram de 2+ equipamentos
// distintos (normalmente entra/sai no mesmo relógio). "Locais muito diferentes".
// Obs.: precisão por GPS (coordenadas do app) depende da API interna do RHiD —
// ver nota no README/instruções; esta versão é por equipamento/obra (robusta).
export type Anomalia = { p: Pessoa; locais: { nome: string; horas: string[] }[] };
export function auditarLocais(dia: DiaPonto): Anomalia[] {
  const anomalias: Anomalia[] = [];
  for (const p of dia.pessoasAtivas) {
    const bs = dia.porPessoa.get(p.id) || [];
    if (bs.length < 2) continue;
    const porDevice = new Map<number, { nome: string; horas: string[] }>();
    for (const b of bs) {
      const e = porDevice.get(b.deviceId) || { nome: b.deviceNome, horas: [] };
      e.horas.push(hhmm(b.ts));
      porDevice.set(b.deviceId, e);
    }
    if (porDevice.size >= 2) {
      anomalias.push({ p, locais: [...porDevice.values()] });
    }
  }
  return anomalias;
}

// ─── Diagnóstico de conexão (para validar credenciais/formatos) ─────────────

// Sonda crua de um endpoint: NÃO lança. Em sucesso mostra só a estrutura
// (sem valores, p/ privacidade); em erro mostra o corpo (p/ depurar 400 etc.).
async function probe(path: string, params: Record<string, any> = {}): Promise<any> {
  try {
    const tok = await obterToken();
    const u = new URL(BASE + path);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
    const r = await fetch(u.toString(), { headers: { Authorization: tok, Accept: "application/json" } });
    const txt = await r.text();
    let j: any = null; try { j = JSON.parse(txt); } catch {}
    if (!r.ok) return { status: r.status, ok: false, bodyHead: txt.slice(0, 300) };
    const arr = j ? comoLista(j) : [];
    return {
      status: r.status,
      ok: true,
      envelope: Array.isArray(j) ? "(array)" : j && typeof j === "object" ? Object.keys(j) : typeof j,
      itens: arr.length,
      primeiroItemCampos: arr[0] ? Object.keys(arr[0]) : [],
    };
  } catch (e: any) {
    return { erro: String(e?.message || e) };
  }
}

export async function diagnostico(dataISO: string): Promise<any> {
  const out: any = { base: BASE };

  // 1) login CRU (sem cache) — p/ ver a estrutura da resposta e o token.
  const lbody: Record<string, string> = { email: EMAIL, password: SENHA };
  if (DOMINIO) lbody.domain = DOMINIO;
  let token = "";
  try {
    const lr = await fetch(`${BASE}/login`, { method: "POST", headers: { "content-type": "application/json", Accept: "application/json" }, body: JSON.stringify(lbody) });
    const lt = await lr.text();
    let lj: any = null; try { lj = JSON.parse(lt); } catch {}
    token = lj?.accessToken || lj?.access_token || lj?.token || "";
    out.login = {
      status: lr.status,
      campos: lj ? Object.keys(lj) : "(não-json)",
      tokenLen: token.length,
      tokenPrefixo: token.slice(0, 4),
      code: lj?.code,
      error: lj?.error,
      expiredPassword: lj?.expiredPassword,
      isPerson: lj?.isPerson,
      qtdCustomers: Array.isArray(lj?.listCustomer) ? lj.listCustomer.length : undefined,
      customers: Array.isArray(lj?.listCustomer)
        ? lj.listCustomer.slice(0, 6).map((c: any) => ({ id: c?.id ?? c?.idCustomer, nome: c?.name ?? c?.nome ?? c?.fantasyName, dominio: c?.domain ?? c?.dominio ?? c?.subdomain, campos: c && typeof c === "object" ? Object.keys(c) : typeof c }))
        : undefined,
      data: typeof lj?.data === "string" ? lj.data.slice(0, 40) : lj?.data,
    };
  } catch (e: any) { out.login = { erro: String(e?.message || e) }; return out; }
  if (!token) return out;

  // 2) tenta variações de autenticação em /person p/ achar a aceita (200).
  async function tryAuth(label: string, headers: Record<string, string>, extra = ""): Promise<any> {
    try {
      const r = await fetch(`${BASE}/person?start=0&length=10${extra}`, { headers });
      const t = await r.text();
      return { label, status: r.status, len: t.length, head: r.ok ? "(ok)" : t.slice(0, 160) };
    } catch (e: any) { return { label, erro: String(e?.message || e) }; }
  }
  out.variantesAuth = [
    await tryAuth("Authorization: token", { Authorization: token, Accept: "application/json" }),
    await tryAuth("Authorization: Bearer token", { Authorization: `Bearer ${token}`, Accept: "application/json" }),
    await tryAuth("header access_token", { access_token: token, Accept: "application/json" }),
    await tryAuth("header token", { token, Accept: "application/json" }),
    await tryAuth("query access_token", { Accept: "application/json" }, `&access_token=${encodeURIComponent(token)}`),
  ];
  return out;
}
