import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(resolve(root, ".env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);
const URL_SB = env.PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json" };
const ATOR = "adriana@costajr.com.br";
const COLAB = "5def5be2-3c86-482c-b1ff-bc52616c6125";
const BUCKET = "rh";
const BASE = "D:/OneDrive - Costa Jr/RH DP/3_Clt/1_Ativos/CRISPIM PEREIRA DA SILVA";
const TEMP = "C:/Users/adriana.russo/AppData/Local/Temp";

async function log(acao, entidade, registro_id, descricao, dados) {
  await fetch(`${URL_SB}/rest/v1/audit_log`, {
    method: "POST", headers: H,
    body: JSON.stringify({ usuario_email: ATOR, usuario_role: "admin", acao, entidade, registro_id: registro_id ? String(registro_id) : null, descricao, dados: dados ?? null, ip: null }),
  });
}

// ─── 1) Ajustar ficha com dados do Registro de Empregado (eSocial) ──────────
const { 0: atual } = await (await fetch(`${URL_SB}/rest/v1/rh_colaboradores?id=eq.${COLAB}&select=*`, { headers: H })).json();
const patch = { updated_at: new Date().toISOString() };

// endereço oficial (Registro de Empregado): bairro Parque dos Bancários
patch.endereco = "Rua Guido Federici, 135-A, Casa 03 - Parque dos Bancários - CEP 03923-170";

const extra = " | Matrícula eSocial: 7801281 | Título Eleitoral: 947008205/66 Zona 044 Seção 0131 | CBO: 514310 (Auxiliar de Manutenção) | Grau de instrução: Ensino Médio Completo | Cor/raça: Preta | Horário: 08:40–17:00 (intervalo 12:00–13:00)";
const obsAtual = atual.observacoes || "";
if (!obsAtual.includes("Matrícula eSocial: 7801281")) patch.observacoes = (obsAtual + extra).trim();

const r = await fetch(`${URL_SB}/rest/v1/rh_colaboradores?id=eq.${COLAB}`, {
  method: "PATCH", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify(patch),
});
if (!r.ok) { console.error("ERRO PATCH:", await r.text()); process.exit(1); }
await log("editar", "rh_colaboradores", COLAB, `Ajustou ficha de "${atual.nome}" pelo Registro de Empregado (endereço oficial, matrícula eSocial, título eleitoral, CBO)`, patch);
console.log("FICHA ajustada:", Object.keys(patch).filter((k) => k !== "updated_at").join(", "));

// ─── 2) Anexar documentos (arquivos disponíveis em disco) ───────────────────
const DOCS = [
  { f: `${BASE}/Admissão/Ficha de registro_Crispim Pereira.pdf`, titulo: "Ficha de Registro — Registro de Empregado (PDF)", tipo: "outro" },
  { f: `${BASE}/Admissão/Kit adimissional_Crispim Pereira.pdf`, titulo: "Kit Admissional", tipo: "outro" },
  { f: `${TEMP}/ADVERTENCIA CRISPIM PEREIRA_05-07-2025_FALTA INSUTIFICADA.pdf`, titulo: "Advertência — 05/07/2025 (falta injustificada)", tipo: "advertencia" },
  { f: `${TEMP}/Advertência_Crispim_21_02_26_assinada.pdf`, titulo: "Advertência — 21/02/2026 (falta injustificada, assinada)", tipo: "advertencia" },
];

const existentes = await (await fetch(`${URL_SB}/rest/v1/rh_documentos?colaborador_id=eq.${COLAB}&select=titulo`, { headers: H })).json();
const titulosExistentes = new Set(existentes.map((d) => d.titulo));

let seq = Date.now();
for (const d of DOCS) {
  if (!existsSync(d.f)) { console.log(`  ⚠️  ARQUIVO NÃO ENCONTRADO: ${d.f}`); continue; }
  if (titulosExistentes.has(d.titulo)) { console.log(`  ↪︎ já anexado, pulando: ${d.titulo}`); continue; }
  const bytes = readFileSync(d.f);
  const storagePath = `documentos/${COLAB}/${seq++}.pdf`;
  const up = await fetch(`${URL_SB}/storage/v1/object/${BUCKET}/${storagePath}`, {
    method: "POST", headers: { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/pdf", "x-upsert": "false" }, body: bytes,
  });
  if (!up.ok) { console.error(`  ❌ upload falhou (${d.titulo}):`, await up.text()); continue; }
  const row = { colaborador_id: COLAB, titulo: d.titulo, tipo: d.tipo, storage_path: storagePath, validade: null, validade_na: false, observacoes: null, criado_por: ATOR };
  const ins = await fetch(`${URL_SB}/rest/v1/rh_documentos`, { method: "POST", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify(row) });
  if (!ins.ok) { console.error(`  ❌ insert falhou (${d.titulo}):`, await ins.text()); continue; }
  const { 0: created } = await ins.json();
  await log("criar", "rh_documentos", created.id, `Anexou documento "${d.titulo}" (arquivo)`, { tipo: d.tipo });
  console.log(`  ✅ anexado [${d.tipo}] ${d.titulo}`);
}
console.log("\nCONCLUÍDO.");
