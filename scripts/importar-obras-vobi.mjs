// Importa TAREFAS e ANOTAÇÕES de obra da Vobi para obras_tarefas / obras_anotacoes.
// Idempotente (upsert por vobi_id). Requer VOBI_UUID/VOBI_SECRET e Supabase no .env.
// Uso: node scripts/importar-obras-vobi.mjs
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n").filter(l => l.includes("=") && !l.startsWith("#"))
    .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);
const SB = env.SUPABASE_URL || env.PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
const VOBI = "https://api.vobi.com.br/v2";
if (!env.VOBI_UUID || !env.VOBI_SECRET) { console.error("Defina VOBI_UUID e VOBI_SECRET no .env"); process.exit(1); }

let token = null, tokenEm = 0;
async function vobiToken() {
  if (token && Date.now() - tokenEm < 4 * 60 * 1000) return token;
  const basic = Buffer.from(`${env.VOBI_UUID}:${env.VOBI_SECRET}`).toString("base64");
  const r = await fetch(`${VOBI}/auth/token`, { method: "POST", headers: { authorization: `Basic ${basic}` } });
  if (!r.ok) throw new Error(`auth/token ${r.status}: ${await r.text()}`);
  const d = await r.json();
  token = d.token || d.jwt || d.accessToken;
  tokenEm = Date.now();
  return token;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function vobiGet(path, tentativa = 1) {
  const t = await vobiToken();
  const r = await fetch(`${VOBI}${path}`, { headers: { authorization: `Bearer ${t}` } });
  if (r.ok) return r.json();
  // 5xx/429 da Cloudflare/Vobi são transientes — tenta de novo com backoff
  if ((r.status >= 500 || r.status === 429) && tentativa <= 12) {
    const espera = Math.min(30000, 3000 * tentativa);
    console.log(`   ⚠ ${r.status} em ${path.split("?")[0]} — retry ${tentativa}/12 em ${espera / 1000}s`);
    await sleep(espera);
    if (r.status === 429 || tentativa >= 3) { token = null; } // renova token se persistir
    return vobiGet(path, tentativa + 1);
  }
  throw new Error(`${path} → ${r.status}: ${(await r.text()).slice(0, 200)}`);
}
async function vobiTodos(base) {
  // paginação com dedupe (a ordenação da API é instável)
  const mapa = new Map();
  let offset = 0;
  for (;;) {
    const d = await vobiGet(`${base}${base.includes("?") ? "&" : "?"}limit=500&offset=${offset}&order[0][0]=id&order[0][1]=asc`);
    const itens = Array.isArray(d) ? d : d.rows || d.data || d.items || [];
    if (!itens.length) break;
    for (const it of itens) mapa.set(it.id, it);
    if (itens.length < 500) break;
    offset += 500;
    if (offset > 20000) break;
  }
  return [...mapa.values()];
}
async function sb(path, opts = {}) {
  const res = await fetch(`${SB}/rest/v1/${path}`, { ...opts, headers: { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json", prefer: "return=representation,resolution=merge-duplicates", ...(opts.headers || {}) } });
  const t = await res.text();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}

console.log("1) Carregando obras (mapa vobi_id → id)...");
const obras = await sb("obras?select=id,vobi_id&vobi_id=not.is.null&limit=2000");
// vobi_id das obras vem como "vobi-409251"; as tarefas/anotações referenciam o número puro (idRefurbish).
// Normaliza ambos para o número, para casar.
const numVobi = (v) => String(v).replace(/^vobi-/, "");
const obraPorVobi = new Map(obras.map(o => [numVobi(o.vobi_id), o.id]));
console.log(`   ${obraPorVobi.size} obras com vobi_id.`);

console.log("2) Baixando etapas (refurbish-step) p/ nomear cronograma...");
let etapaNome = new Map();
try {
  const steps = await vobiTodos("/refurbish-step");
  etapaNome = new Map(steps.map(s => [String(s.id), s.name]));
  console.log(`   ${etapaNome.size} etapas.`);
} catch (e) { console.log("   (sem acesso a etapas: " + e.message.slice(0, 80) + ")"); }

console.log("3) Baixando tarefas...");
const tasks = await vobiTodos("/task");
console.log(`   ${tasks.length} tarefas na Vobi.`);
const STATUS = { 1: "pendente", 2: "em_andamento", 4: "concluida", 5: "cancelada" };
const PRIOR = { 1: "baixa", 2: "media", 3: "alta" };
const tarefas = tasks
  .filter(t => obraPorVobi.has(numVobi(t.idRefurbish)))
  .map(t => ({
    obra_id: obraPorVobi.get(numVobi(t.idRefurbish)),
    titulo: (t.name || "(sem título)").slice(0, 300),
    descricao: t.description ? String(t.description).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 2000) || null : null,
    etapa: etapaNome.get(String(t.idRefurbishStep)) || null,
    status: STATUS[t.status] || "pendente",
    prioridade: PRIOR[t.priority] || null,
    data_inicio: t.startDate ? String(t.startDate).slice(0, 10) : null,
    data_fim: t.endDate ? String(t.endDate).slice(0, 10) : null,
    ordem: Math.round(Number(t.order) || 0),
    vobi_id: String(t.id),
  }));
const semObra = tasks.length - tarefas.length;
console.log(`   ${tarefas.length} com obra correspondente (${semObra} sem obra → ignoradas).`);
for (let i = 0; i < tarefas.length; i += 500) {
  await sb("obras_tarefas?on_conflict=vobi_id", { method: "POST", body: JSON.stringify(tarefas.slice(i, i + 500)) });
  console.log(`   upsert ${Math.min(i + 500, tarefas.length)}/${tarefas.length}`);
}

console.log("4) Baixando anotações (refurbish-notes)...");
const notes = await vobiTodos("/refurbish-notes");
console.log(`   ${notes.length} anotações na Vobi.`);
const anots = notes
  .filter(n => obraPorVobi.has(String(n.idRefurbish)) && (n.note || "").trim())
  .map(n => ({
    obra_id: obraPorVobi.get(String(n.idRefurbish)),
    texto: String(n.note).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 4000),
    criado_por: "importado da Vobi",
    vobi_id: String(n.id),
  }))
  .filter(a => a.texto);
console.log(`   ${anots.length} com obra correspondente.`);
for (let i = 0; i < anots.length; i += 500) {
  await sb("obras_anotacoes?on_conflict=vobi_id", { method: "POST", body: JSON.stringify(anots.slice(i, i + 500)) });
  console.log(`   upsert ${Math.min(i + 500, anots.length)}/${anots.length}`);
}

console.log(`\nCONCLUÍDO: ${tarefas.length} tarefas + ${anots.length} anotações importadas/atualizadas.`);
