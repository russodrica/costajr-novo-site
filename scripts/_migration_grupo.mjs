// Roda 1x: node scripts/_migration_grupo.mjs
// Adiciona a coluna 'grupo' em doc_empresa para sub-agrupar dentro de Documento Fiscal.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(resolve(__dir, "../.env"), "utf-8")
    .split("\n").filter(l => l.includes("=") && !l.startsWith("#"))
    .map(l => { const i = l.indexOf("="); return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,"")]; })
);

const url = env.PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Falta PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY no .env"); process.exit(1); }

const sb = createClient(url, key);

// Verifica se a coluna já existe
const { data: cols } = await sb
  .from("information_schema.columns" as any)
  .select("column_name")
  .eq("table_name", "doc_empresa")
  .eq("column_name", "grupo");

if (cols && cols.length > 0) {
  console.log("✓ Coluna 'grupo' já existe em doc_empresa — nada a fazer.");
  process.exit(0);
}

// Não dá pra rodar DDL pelo PostgREST, então orientamos a rodar no SQL Editor
console.log(`
══════════════════════════════════════════════════════
  A coluna 'grupo' ainda NÃO existe em doc_empresa.
  Rode o SQL abaixo no Editor SQL do Supabase:

  ALTER TABLE doc_empresa ADD COLUMN IF NOT EXISTS grupo text;
  COMMENT ON COLUMN doc_empresa.grupo IS 'Sub-grupo dentro de Documento Fiscal: CND | Trabalhistas | Sócios | Diversos';

  Após rodar, re-execute este script para confirmar.
══════════════════════════════════════════════════════
`);
process.exit(1);
