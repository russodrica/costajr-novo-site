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
  const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${tok}`, Accept: asText ? "text/plain, */*" : "application/json" } });
  if (r.status === 401) {
    // token pode ter expirado entre as chamadas — renova uma vez
    _token = ""; _tokenExp = 0;
    const tok2 = await obterToken();
    const r2 = await fetch(u.toString(), { headers: { Authorization: `Bearer ${tok2}`, Accept: asText ? "text/plain, */*" : "application/json" } });
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

// A API limita o tamanho da página (length grande -> 400/500). Paginamos.
async function coletarPaginado(path: string, pageSize = 100, maxPages = 60): Promise<any[]> {
  const todos: any[] = [];
  for (let page = 0; page < maxPages; page++) {
    const j = await apiGet(path, { start: page * pageSize, length: pageSize });
    const arr = comoLista(j);
    todos.push(...arr);
    if (arr.length < pageSize) break; // última página
  }
  return todos;
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
  const lista = await coletarPaginado("/person", 100);
  return lista.map((p: any) => ({
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
  const lista = await coletarPaginado("/device", 100);
  return lista
    .map((d: any) => ({
      id: Number(d.id ?? d.idDevice ?? d.deviceId),
      nome: String(d.name ?? d.description ?? d.nome ?? d.alias ?? `Equip. ${d.id}`).trim(),
    }))
    .filter((d) => Number.isFinite(d.id));
}

// ─── AFD (batidas) ──────────────────────────────────────────────────────────
export type Batida = { pis: string; ts: Date; nsr: string; deviceId: number; deviceNome: string };

// Baixa o AFD completo de um equipamento e o normaliza.
// IMPORTANTE: a API devolve o AFD como STRING JSON (entre aspas, com \r\n
// escapados). E o filtro por data via parâmetro retorna vazio — então
// baixamos tudo e filtramos a data no cliente (coletarBatidasDoDia).
async function baixarAfd(idEquipamento: number): Promise<string> {
  const raw = await apiGet("/report/afd/download", { idEquipamento }, true);
  let s = typeof raw === "string" ? raw : String(raw ?? "");
  if (s.startsWith('"')) { try { s = JSON.parse(s); } catch { /* mantém cru */ } }
  return s;
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
      texto = await baixarAfd(eq.id);
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

// ─── Diagnóstico de conexão (para validar credenciais e formatos) ───────────
export async function diagnostico(dataISO: string): Promise<any> {
  const out: any = { base: BASE, data: dataISO };
  try { const tok = await obterToken(); out.login = { ok: true, tokenLen: tok.length }; }
  catch (e: any) { out.login = { ok: false, erro: String(e?.message || e) }; return out; }

  // Funcionários + distribuição de status (p/ confirmar qual status = ativo).
  try {
    const pessoas = await listarPessoas();
    const dist: Record<string, number> = {};
    for (const p of pessoas) dist[String(p.statusRaw)] = (dist[String(p.statusRaw)] || 0) + 1;
    out.pessoas = pessoas.length;
    out.pessoasAtivas = pessoas.filter((p) => p.ativo).length;
    out.ativasComPis = pessoas.filter((p) => p.ativo && p.pis).length;
    out.distribuicaoStatus = dist;
  } catch (e: any) { out.pessoasErro = String(e?.message || e); }

  // Equipamentos.
  let equips: Equipamento[] = [];
  try { equips = await listarEquipamentos(); out.equipamentos = equips.map((e) => e.nome); }
  catch (e: any) { out.equipErro = String(e?.message || e); }

  // AFD de CADA equipamento, com e sem limit — p/ achar onde estão as batidas
  // recentes e se a API trunca (devolve só os registros mais antigos).
  out.afdPorEquip = [];
  for (const eq of equips) {
    const row: any = { eq: eq.nome };
    for (const [lbl, params] of [["sem", {}], ["limit", { limit: 999999 }]] as [string, Record<string, any>][]) {
      try {
        const raw = String(await apiGet("/report/afd/download", { idEquipamento: eq.id, ...params }, true));
        let s = raw; if (s.startsWith('"')) { try { s = JSON.parse(s); } catch {} }
        const recs = parseAfd(s);
        const datas = recs.map((r) => fmtDataISO(r.ts)).sort();
        row[lbl] = {
          parsed: recs.length,
          dataMin: datas[0],
          dataMax: datas[datas.length - 1],
          naDataAlvo: recs.filter((r) => fmtDataISO(r.ts) === dataISO).length,
          maxNsr: recs.reduce((m, r) => Math.max(m, Number(r.nsr) || 0), 0),
        };
      } catch (e: any) { row[lbl] = { erro: String(e?.message || e) }; }
    }
    out.afdPorEquip.push(row);
  }

  // Fonte ALTERNATIVA: apuracao_ponto (ponto apurado/live). Pode ter dados
  // recentes mesmo que o AFD baixável esteja parado. Testa 1 pessoa ativa em
  // 2 datas: a alvo e uma com dados conhecidos (2025-05-20).
  try {
    const pessoas = await listarPessoas();
    const p = pessoas.find((x) => x.ativo && x.pis && !/teste|test/i.test(x.nome)) || pessoas.find((x) => x.ativo && x.pis);
    out.apuracao = [];
    if (p) {
      for (const dt of [dataISO, "2025-05-20"]) {
        try {
          const raw = String(await apiGet("/apuracao_ponto", { idPerson: p.id, dataIni: dt, dataFinal: dt }, true));
          let parsed: any = null; try { parsed = JSON.parse(raw); } catch {}
          const dia0 = Array.isArray(parsed) ? parsed[0] : parsed;
          const campos = dia0 && typeof dia0 === "object" ? Object.keys(dia0) : null;
          const camposArray: Record<string, any> = {};
          if (dia0 && typeof dia0 === "object") {
            for (const k of Object.keys(dia0)) if (Array.isArray(dia0[k]) && dia0[k].length) camposArray[k] = dia0[k].slice(0, 8);
          }
          out.apuracao.push({ data: dt, idPerson: p.id, campos, camposComArray: camposArray });
        } catch (e: any) { out.apuracao.push({ data: dt, erro: String(e?.message || e) }); }
      }
    }
  } catch (e: any) { out.apuracaoErro = String(e?.message || e); }

  // Pipeline real de batidas (como os alertas usam).
  try {
    const batidas = await coletarBatidasDoDia(dataISO, equips);
    out.batidasNoDia = batidas.length;
    out.amostraBatidas = batidas.slice(0, 6).map((b) => ({ hora: hhmm(b.ts), equipamento: b.deviceNome, pisCasou: !!b.pis }));
  } catch (e: any) { out.batidasErro = String(e?.message || e); }

  return out;
}
