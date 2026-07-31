/**
 * Runner de migrations do Portal CJR.
 *
 *   npm run db:migrate              → aplica o que falta
 *   npm run db:migrate -- --seco    → só mostra o que faria, sem executar
 *   npm run db:migrate -- --forcar 079_vendas_precificacao.sql
 *
 * Precisa da variável de ambiente SUPABASE_DB_URL (ou DATABASE_URL) — a
 * connection string do Postgres, achada em:
 *   Supabase → Project Settings → Database → Connection string → URI
 *
 * ---------------------------------------------------------------------------
 * PRIMEIRA EXECUÇÃO (importante)
 *
 * Este projeto já tem dezenas de migrations aplicadas à mão pelo SQL Editor.
 * Por isso, quando a tabela de controle ainda não existe, o runner NÃO executa
 * nada: ele cria a tabela e marca todos os arquivos atuais como "já aplicados"
 * (baseline). Assim não há risco de reexecutar 79 arquivos em produção.
 * A partir daí, só arquivos NOVOS são executados.
 * ---------------------------------------------------------------------------
 *
 * Trava de segurança: seguindo a regra do próprio projeto (db/COMO_MIGRAR.md),
 * migration só pode ser aditiva. Arquivos com comandos destrutivos são
 * recusados. Para um caso legítimo e revisado, inclua no topo do arquivo:
 *     -- @permite-destrutivo: <motivo>
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const AQUI = dirname(fileURLToPath(import.meta.url));
const PASTA = join(AQUI, "migrations");
const RAIZ = join(AQUI, "..");

/**
 * Carrega o .env da raiz do projeto, se existir — assim `npm run db:migrate`
 * funciona localmente sem precisar exportar variável na mão. No GitHub Actions
 * não há .env: lá as variáveis vêm dos secrets, e o que já está no ambiente
 * sempre tem prioridade sobre o arquivo.
 */
function carregarEnvLocal() {
  const caminho = join(RAIZ, ".env");
  if (!existsSync(caminho)) return;
  for (const linha of readFileSync(caminho, "utf8").split(/\r?\n/)) {
    const t = linha.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 1) continue;
    const chave = t.slice(0, i).trim();
    if (process.env[chave] !== undefined) continue; // ambiente ganha do arquivo
    let valor = t.slice(i + 1).trim();
    if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
      valor = valor.slice(1, -1);
    }
    process.env[chave] = valor;
  }
}
carregarEnvLocal();

const args = process.argv.slice(2);
const SECO = args.includes("--seco") || args.includes("--dry-run");
const idxForcar = args.indexOf("--forcar");
const FORCAR = idxForcar >= 0 ? args[idxForcar + 1] : null;

/** Comandos que apagam dados. A regra do projeto é: migration é aditiva. */
const DESTRUTIVOS: { re: RegExp; nome: string }[] = [
  { re: /\bdrop\s+table\b/i, nome: "DROP TABLE" },
  { re: /\bdrop\s+column\b/i, nome: "DROP COLUMN" },
  { re: /\bdrop\s+schema\b/i, nome: "DROP SCHEMA" },
  { re: /\btruncate\b/i, nome: "TRUNCATE" },
  // DELETE sem WHERE
  { re: /\bdelete\s+from\s+[^;]*?;/i, nome: "DELETE sem WHERE" },
];

function checarDestrutivo(sql: string, arquivo: string): string | null {
  if (/--\s*@permite-destrutivo/i.test(sql)) return null;
  const semComentarios = sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
  for (const d of DESTRUTIVOS) {
    if (d.nome === "DELETE sem WHERE") {
      const m = semComentarios.match(/\bdelete\s+from\s+[^;]*;/gi) || [];
      const semWhere = m.filter((t) => !/\bwhere\b/i.test(t));
      if (semWhere.length) return `${arquivo}: ${d.nome}`;
      continue;
    }
    if (d.re.test(semComentarios)) return `${arquivo}: ${d.nome}`;
  }
  return null;
}

/**
 * Escapa um literal de texto para embutir direto no SQL.
 *
 * De propósito NÃO usamos query parametrizada ($1, $2) aqui: parâmetro usa o
 * protocolo estendido do Postgres (prepared statement), que o pooler do
 * Supabase em modo "transaction" pode recusar. Assim o runner funciona em
 * qualquer modo de conexão — direta, session pooler ou transaction pooler.
 */
function lit(cli: Client, valor: string): string {
  return (cli as any).escapeLiteral(valor);
}

function listarArquivos(): string[] {
  return readdirSync(PASTA)
    .filter((f) => f.toLowerCase().endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

async function main() {
  const url = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error("✗ Falta SUPABASE_DB_URL (ou DATABASE_URL).");
    console.error("  Supabase → Project Settings → Database → Connection string → URI");
    process.exit(1);
  }

  const arquivos = listarArquivos();
  if (!arquivos.length) {
    console.log("Nenhuma migration encontrada em db/migrations/.");
    return;
  }

  const cli = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await cli.connect();

  try {
    // A tabela de controle já existia antes desta execução?
    const { rows: existe } = await cli.query(
      `select to_regclass('public._migrations_aplicadas') is not null as tem`
    );
    const jaTinhaControle = existe[0]?.tem === true;

    await cli.query(`
      create table if not exists _migrations_aplicadas (
        arquivo     text primary key,
        aplicada_em timestamptz not null default now(),
        aplicada_por text
      )
    `);

    // --------- baseline na primeira execução ---------
    if (!jaTinhaControle && !FORCAR) {
      console.log("Primeira execução: criando controle de migrations.");
      console.log(`Marcando ${arquivos.length} arquivo(s) já existentes como aplicados (baseline).`);
      console.log("NADA foi executado — estes já haviam sido rodados à mão no SQL Editor.\n");
      if (SECO) { console.log("(--seco: nem o baseline foi gravado)"); return; }
      for (const f of arquivos) {
        await cli.query(
          `insert into _migrations_aplicadas (arquivo, aplicada_por)
           values (${lit(cli, f)}, ${lit(cli, "baseline")})
           on conflict (arquivo) do nothing`
        );
      }
      console.log("✓ Baseline gravado. A partir de agora, só migrations NOVAS serão aplicadas.");
      return;
    }

    // --------- execução normal ---------
    const { rows: aplicadasRows } = await cli.query(`select arquivo from _migrations_aplicadas`);
    const aplicadas = new Set(aplicadasRows.map((r: any) => r.arquivo));

    let pendentes = arquivos.filter((f) => !aplicadas.has(f));
    if (FORCAR) {
      if (!arquivos.includes(FORCAR)) {
        console.error(`✗ Arquivo não encontrado em db/migrations/: ${FORCAR}`);
        process.exit(1);
      }
      pendentes = [FORCAR];
      console.log(`Modo --forcar: reaplicando ${FORCAR}\n`);
    }

    if (!pendentes.length) {
      console.log("✓ Nada pendente. Banco em dia.");
      return;
    }

    // valida TODAS antes de aplicar qualquer uma
    const problemas = pendentes
      .map((f) => checarDestrutivo(readFileSync(join(PASTA, f), "utf8"), f))
      .filter(Boolean) as string[];
    if (problemas.length) {
      console.error("✗ Migration com comando destrutivo — recusada pela regra do projeto:");
      problemas.forEach((p) => console.error("   " + p));
      console.error("\n  Se for intencional e revisado, adicione no topo do arquivo:");
      console.error("   -- @permite-destrutivo: <motivo>");
      process.exit(1);
    }

    console.log(`${pendentes.length} migration(s) pendente(s):`);
    pendentes.forEach((f) => console.log("   • " + f));
    if (SECO) { console.log("\n(--seco: nada foi executado)"); return; }
    console.log("");

    for (const f of pendentes) {
      const sql = readFileSync(join(PASTA, f), "utf8");
      process.stdout.write(`  aplicando ${f} … `);
      try {
        await cli.query("begin");
        await cli.query(sql);
        await cli.query(
          `insert into _migrations_aplicadas (arquivo, aplicada_por)
           values (${lit(cli, f)}, ${lit(cli, process.env.GITHUB_ACTOR || "local")})
           on conflict (arquivo) do update set aplicada_em = now()`
        );
        await cli.query("commit");
        console.log("ok");
      } catch (e: any) {
        await cli.query("rollback").catch(() => {});
        console.log("FALHOU");
        console.error(`\n✗ ${f}: ${e.message}`);
        console.error("  Nada dessa migration foi aplicado (rollback). As anteriores continuam valendo.");
        process.exit(1);
      }
    }
    console.log("\n✓ Todas as migrations pendentes foram aplicadas.");
  } finally {
    await cli.end().catch(() => {});
  }
}

main().catch((e) => {
  console.error("✗ Erro inesperado:", e.message);
  process.exit(1);
});
