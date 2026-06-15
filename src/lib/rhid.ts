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
// API interna (usada pela tela "Marcações REP-P"); base diferente da api.svc.
const CDB = "https://rhid.com.br/v2/customerdb";
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

// ─── Montagem do "dia" via APURAÇÃO DE PONTO ─────────────────────────────────
// Fonte real das batidas (inclusive do app). A apuração já vem classificada:
// batida real = item com idAfd != null; "Falta no período" (idAfd null) = horário
// esperado não batido; _typeClassification "X" = entrada sem saída.

// "2026-06-15T08:15:00" (horário de parede) -> Date UTC com os mesmos números
// (formatamos sempre em UTC, igual ao AFD, p/ não deslocar fuso).
function parseApurDate(s: any): Date | null {
  const m = String(s || "").match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m;
  return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(se || 0)));
}

export type PessoaDia = {
  pessoa: Pessoa;
  trabalhaHoje: boolean; // tem horário cadastrado e período esperado/registrado hoje
  punches: Date[];       // batidas REAIS (idAfd != null), ordenadas
  semSaida: boolean;     // entrou e ainda não bateu a saída
};
export type DiaPonto = { dataISO: string; dias: PessoaDia[] };

async function apuracaoDia(idPerson: number, dataISO: string): Promise<{ trabalhaHoje: boolean; punches: Date[]; semSaida: boolean }> {
  let parsed: any = null;
  try {
    const raw = String(await apiGet("/apuracao_ponto", { idPerson, dataIni: dataISO, dataFinal: dataISO }, true));
    parsed = JSON.parse(raw); if (typeof parsed === "string") parsed = JSON.parse(parsed);
  } catch { return { trabalhaHoje: false, punches: [], semSaida: false }; }
  const d0 = Array.isArray(parsed) ? parsed[0] : parsed;
  const lst: any[] = d0 && Array.isArray(d0.listAfdtManutencao) ? d0.listAfdtManutencao : [];
  if (!lst.length) return { trabalhaHoje: false, punches: [], semSaida: false }; // sem horário / folga
  const punches = lst
    .filter((e) => e && e.idAfd != null)
    .map((e) => parseApurDate(e.dateTime))
    .filter((x): x is Date => !!x)
    .sort((a, b) => a.getTime() - b.getTime());
  const semSaida = lst.some((e) => e && e._typeClassification === "X") || punches.length % 2 === 1;
  return { trabalhaHoje: true, punches, semSaida };
}

// Executa fn em paralelo com concorrência limitada (1 login + N chamadas).
async function mapLimite<T, R>(itens: T[], limite: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(itens.length);
  let i = 0;
  const worker = async () => { while (i < itens.length) { const idx = i++; out[idx] = await fn(itens[idx]); } };
  await Promise.all(Array.from({ length: Math.min(limite, itens.length || 1) }, worker));
  return out;
}

export async function montarDia(dataISO: string): Promise<DiaPonto> {
  // precisa de PIS; ignora contas de teste (ex.: "Adriana (teste)").
  const pessoas = (await listarPessoas()).filter((p) => p.pis && !/teste/i.test(p.nome));
  const apur = await mapLimite(pessoas, 12, (p) => apuracaoDia(p.id, dataISO));
  const dias: PessoaDia[] = pessoas.map((pessoa, idx) => ({ pessoa, ...apur[idx] }));
  return { dataISO, dias };
}

export function trabalhamHoje(dia: DiaPonto): number {
  return dia.dias.filter((d) => d.trabalhaHoje).length;
}

// ─── Relatórios de negócio ──────────────────────────────────────────────────

// ENTRADA: quem trabalha hoje e ainda não tem nenhuma batida real.
export function relatorioEntrada(dia: DiaPonto): { semEntrada: Pessoa[]; comEntrada: Pessoa[] } {
  const semEntrada: Pessoa[] = [];
  const comEntrada: Pessoa[] = [];
  for (const d of dia.dias) {
    if (!d.trabalhaHoje) continue;
    (d.punches.length > 0 ? comEntrada : semEntrada).push(d.pessoa);
  }
  return { semEntrada, comEntrada };
}

// SAÍDA: quem já bateu a saída x quem entrou e está em aberto.
export function relatorioSaida(dia: DiaPonto): { bateuSaida: { p: Pessoa; ultima: string }[]; semSaida: { p: Pessoa; desde: string }[] } {
  const bateuSaida: { p: Pessoa; ultima: string }[] = [];
  const semSaida: { p: Pessoa; desde: string }[] = [];
  for (const d of dia.dias) {
    if (!d.trabalhaHoje || d.punches.length === 0) continue;
    const ult = d.punches[d.punches.length - 1];
    if (d.semSaida) semSaida.push({ p: d.pessoa, desde: hhmm(ult) });
    else bateuSaida.push({ p: d.pessoa, ultima: hhmm(ult) });
  }
  return { bateuSaida, semSaida };
}

// AUDITORIA DE LOCAL: a apuração não traz GPS/equipamento por batida. Auditoria
// por localização do app depende de outra fonte (a confirmar com a Control iD).
// Desabilitada por ora — retorna vazio (não dispara alerta).
export type Anomalia = { p: Pessoa; locais: { nome: string; horas: string[] }[] };
export function auditarLocais(_dia: DiaPonto): Anomalia[] { return []; }

// Sonda: tenta ler as marcações REP-P (com GPS) do servidor (customerdb/afd_mobile).
// Testa combinações de corpo/auth p/ ver se o token de login serve fora do SPA.
export async function probeAfdMobile(dataIni: string, dataFinal: string): Promise<any> {
  const tok = await obterToken();
  const url = `${CDB}/afd.svc/afd_mobile`;
  const bodies: { label: string; body: any }[] = [
    { label: "datas+token+pag", body: { token: tok, dataInicial: dataIni, dataFinal: dataFinal, start: 0, length: 50 } },
    { label: "datatables", body: { dataInicial: dataIni, dataFinal: dataFinal, draw: 1, start: 0, length: 50, columns: [], order: [], search: { value: "", regex: false } } },
    { label: "iso-curto", body: { dataIni, dataFinal, token: tok } },
  ];
  const auths: { label: string; h: Record<string, string> }[] = [
    { label: "bearer", h: { Authorization: `Bearer ${tok}` } },
    { label: "token-puro", h: { Authorization: tok } },
    { label: "sem", h: {} },
  ];
  const tentativas: any[] = [];
  for (const b of bodies) for (const a of auths) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", Accept: "application/json", ...a.h }, body: JSON.stringify(b.body) });
      const t = await r.text();
      const hasLat = /latitude/i.test(t);
      tentativas.push({ body: b.label, auth: a.label, status: r.status, hasLat, head: t.slice(0, 140) });
      if (r.ok && hasLat) return { ok: true, body: b.label, auth: a.label, len: t.length, tentativas };
    } catch (e: any) { tentativas.push({ body: b.label, auth: a.label, erro: String(e?.message || e) }); }
  }
  return { ok: false, tentativas };
}

// ─── Diagnóstico ────────────────────────────────────────────────────────────
// Foca em UMA pessoa (por nome) numa data: despeja a apuração dela, revelando
// as batidas do app (horário/tipo/idAfd e GPS, se houver). É assim que vamos
// confirmar a fonte certa das batidas feitas pelo aplicativo.
export async function diagnostico(dataISO: string, nome?: string): Promise<any> {
  const out: any = { base: BASE, data: dataISO };
  try { const tok = await obterToken(); out.login = { ok: true, tokenLen: tok.length }; }
  catch (e: any) { out.login = { ok: false, erro: String(e?.message || e) }; return out; }

  let pessoas: Pessoa[] = [];
  try { pessoas = await listarPessoas(); out.pessoas = pessoas.length; out.pessoasAtivas = pessoas.filter((p) => p.ativo).length; }
  catch (e: any) { out.pessoasErro = String(e?.message || e); }

  const alvo = nome
    ? pessoas.find((p) => p.nome.toLowerCase().includes(nome.toLowerCase()))
    : pessoas.find((p) => p.ativo && p.pis && !/teste|test/i.test(p.nome));
  if (!alvo) { out.pessoaAlvo = "não encontrada"; return out; }
  out.pessoaAlvo = { id: alvo.id, nome: alvo.nome, ativo: alvo.ativo, temPis: !!alvo.pis };

  try {
    const raw = String(await apiGet("/apuracao_ponto", { idPerson: alvo.id, dataIni: dataISO, dataFinal: dataISO }, true));
    let parsed: any = null; try { parsed = JSON.parse(raw); if (typeof parsed === "string") parsed = JSON.parse(parsed); } catch {}
    const d0 = Array.isArray(parsed) ? parsed[0] : parsed;
    out.apur = { rawLen: raw.length, campos: d0 && typeof d0 === "object" ? Object.keys(d0).length : null };
    if (d0 && typeof d0 === "object") {
      for (const k of Object.keys(d0)) {
        if (Array.isArray(d0[k]) && d0[k].length) {
          out.apur["arr_" + k] = d0[k].slice(0, 12).map((it: any) =>
            it && typeof it === "object"
              ? { dateTime: it.dateTime, hora: it.hora, idAfd: it.idAfd, tReg: it._typeRegister, tCls: it._typeClassification, reason: typeof it.reason === "string" ? it.reason.slice(0, 36) : it.reason, lat: it.latitude ?? it.lat ?? it.gpsLatitude, lng: it.longitude ?? it.lng ?? it.gpsLongitude }
              : it,
          );
        }
      }
    }
  } catch (e: any) { out.apurErro = String(e?.message || e); }

  return out;
}
