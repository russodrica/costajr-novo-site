// ============================================================================
// Importa a base de serviços padronizada (BASE_MESTRE) para o Supabase
// (módulo Orçamentos — Fase 1). Idempotente: upsert por `codigo`.
//
// Fonte: scripts/seed/orc_servicos.json — gerado a partir de
//   ORÇAMENTO BASE\Banco de Dados\BASE_MESTRE_SERVICOS_v1.xlsx pelo
//   gerador Python finalize_seed.py. Para reimportar após revisão da
//   auditoria: regenere o JSON e rode este script de novo.
//
// Requer no .env: PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.
// Uso: node scripts/importar-base-orcamento.mjs [caminho/para/orc_servicos.json]
// ============================================================================

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(resolve(root, ".env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);

const SUPABASE_URL = env.PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const SB_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SB_KEY) {
  console.error("Faltam PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no .env");
  process.exit(1);
}

const arquivo = process.argv[2] || resolve(root, "scripts/seed/orc_servicos.json");
const servicos = JSON.parse(readFileSync(arquivo, "utf8"));
console.log(`Lendo ${servicos.length} serviços de ${arquivo}`);

const CAMPOS = [
  "codigo", "disciplina", "macrogrupo", "grupo", "descricao", "unidade",
  "custo_material", "custo_mao_obra", "fonte", "status_auditoria",
  "observacoes", "data_atualizacao",
];

function limpar(s) {
  const row = {};
  for (const c of CAMPOS) row[c] = s[c] === undefined ? null : s[c];
  row.custo_material = Number(s.custo_material || 0);
  row.custo_mao_obra = Number(s.custo_mao_obra || 0);
  row.ativo = true;
  return row;
}

async function upsert(rows) {
  // PostgREST upsert: Prefer resolution=merge-duplicates resolve o conflito pela PK (codigo).
  const res = await fetch(`${SUPABASE_URL}/rest/v1/orc_servicos?on_conflict=codigo`, {
    method: "POST",
    headers: {
      apikey: SB_KEY,
      authorization: `Bearer ${SB_KEY}`,
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
}

const CHUNK = 500;
let feitos = 0;
const t0 = Date.now();
for (let i = 0; i < servicos.length; i += CHUNK) {
  const lote = servicos.slice(i, i + CHUNK).map(limpar);
  await upsert(lote);
  feitos += lote.length;
  console.log(`  ${feitos}/${servicos.length}`);
}

// Conferência
const cnt = await fetch(`${SUPABASE_URL}/rest/v1/orc_servicos?select=codigo`, {
  method: "HEAD",
  headers: { apikey: SB_KEY, authorization: `Bearer ${SB_KEY}`, prefer: "count=exact" },
});
const total = cnt.headers.get("content-range")?.split("/")?.[1] || "?";
console.log(`\n✅ Upsert concluído em ${((Date.now() - t0) / 1000).toFixed(1)}s. Total na tabela: ${total}`);
