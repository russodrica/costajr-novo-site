#!/usr/bin/env node
/**
 * PONTE COMERCIAL — Telegram → pasta do Comercial (roda NA MÁQUINA da Adriana)
 * ---------------------------------------------------------------------------
 * POR QUE ESTE SCRIPT EXISTE (05/08/2026):
 * O bot do Telegram roda na Vercel e NÃO alcança o computador da Adriana.
 * E as sessões do Claude rodam num sandbox que não tem rota até o
 * costajr.com.br nem até o Telegram. O único ambiente que alcança os dois
 * lados é a máquina dela. Então a ponte mora aqui.
 *
 * REGRA DA ADRIANA: nada de arquivo em nuvem nossa. O arquivo sai do Telegram
 * e cai direto na pasta do projeto — não passa por Supabase nem por storage.
 *
 * O QUE FAZ
 *   1. Pergunta ao site quais serviços de orçamento estão pendentes.
 *   2. Para cada um, cria  _CLAUDE COMERCIAL\<CLIENTE>_<ESCOPO>\  e baixa os
 *      arquivos (projeto/planilha) direto do Telegram pra dentro dela.
 *   3. Grava _DADOS_DA_PROPOSTA.json com o que o bot já apurou (cliente,
 *      endereço, escopo, prazos, valor, percentuais, id da Vobi).
 *   4. Se achar um _PRONTO.txt na pasta (deixado pelo Claude ao terminar o
 *      orçamento), avisa no grupo do Telegram e fecha o serviço.
 *
 * COMO USAR
 *   node scripts/comercial-puxar-jobs.mjs
 *   (ou dê dois cliques em COMERCIAL-PUXAR.cmd)
 *   Para rodar sozinho: Agendador de Tarefas do Windows, a cada 5 minutos.
 *
 * Lê INTEGRA_TELEGRAM_SECRET do .env do próprio repositório.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const PASTA_COMERCIAL =
  process.env.PASTA_COMERCIAL ||
  "D:\\OneDrive - Costa Jr\\Comercial\\3_Propostas\\_EM ANDAMENTO\\_CLAUDE COMERCIAL";

function lerEnv() {
  const env = {};
  try {
    for (const linha of readFileSync(join(RAIZ, ".env"), "utf8").split(/\r?\n/)) {
      const m = linha.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].trim();
    }
  } catch { /* sem .env → cai nas variáveis de ambiente */ }
  return env;
}
const ENV = lerEnv();
const SEGREDO = process.env.INTEGRA_TELEGRAM_SECRET || ENV.INTEGRA_TELEGRAM_SECRET || "";
// O apex redireciona pro www e alguns clientes não seguem — usa www direto.
const SITE = (process.env.SITE_BASE_URL || ENV.SITE_BASE_URL || "https://www.costajr.com.br")
  .replace(/\/$/, "").replace(/^https?:\/\/costajr\.com\.br$/i, "https://www.costajr.com.br");
const API = `${SITE}/api/integra/comercial-jobs`;

if (!SEGREDO) {
  console.error("✖ INTEGRA_TELEGRAM_SECRET não encontrado no .env — não dá pra falar com o site.");
  process.exit(1);
}

const cab = { "x-integra-secret": SEGREDO };

// Nome de pasta seguro no Windows (sem \ / : * ? " < > |).
function pastaSegura(s) {
  return String(s || "").normalize("NFC").replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ").trim().replace(/\.+$/, "").slice(0, 90) || "SEM NOME";
}

async function jsonDaApi(url) {
  const r = await fetch(url, { headers: cab });
  const txt = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} — ${txt.slice(0, 200)}`);
  try { return JSON.parse(txt); } catch { throw new Error(`resposta não-JSON: ${txt.slice(0, 200)}`); }
}

async function baixarArquivo(jobId, indice, destino) {
  const r = await fetch(`${API}?id=${encodeURIComponent(jobId)}&arquivo=${indice}`, { headers: cab });
  if (!r.ok) throw new Error(`HTTP ${r.status} ao baixar arquivo ${indice}`);
  writeFileSync(destino, Buffer.from(await r.arrayBuffer()));
}

async function fecharJob(jobId, mensagem, status = "concluido") {
  const r = await fetch(API, {
    method: "POST",
    headers: { ...cab, "content-type": "application/json" },
    body: JSON.stringify({ id: jobId, status, mensagem }),
  });
  return r.ok;
}

// ── 1) Puxar os serviços pendentes ─────────────────────────────────────────
async function puxar() {
  const { jobs = [] } = await jsonDaApi(API);
  if (!jobs.length) { console.log("• Nenhum serviço novo."); return []; }

  const criadas = [];
  for (const job of jobs) {
    const p = job.proposta || {};
    // clienteCurto = sigla do cliente recorrente (CRF, STD, CHB, SFT), que o
    // site já resolveu. Cliente sem sigla vem com o nome completo.
    const nome = pastaSegura(`${p.clienteCurto || p.cliente || "CLIENTE"}_${p.escopoCurto || "ESCOPO"}`);
    const pasta = join(PASTA_COMERCIAL, nome);
    const marcador = join(pasta, "_JOB.json");

    if (existsSync(marcador)) { console.log(`• ${nome}: já baixado, pulando.`); continue; }
    mkdirSync(pasta, { recursive: true });

    let ok = 0;
    for (const a of job.arquivos || []) {
      const destino = join(pasta, pastaSegura(a.nome || `arquivo-${a.indice}`));
      try { await baixarArquivo(job.id, a.indice, destino); ok++; console.log(`   ↓ ${a.nome}`); }
      catch (e) { console.warn(`   ✖ ${a.nome}: ${e.message}`); }
    }

    writeFileSync(join(pasta, "_DADOS_DA_PROPOSTA.json"), JSON.stringify({
      id: job.id, solicitante: job.solicitante, recebido_em: new Date().toISOString(),
      ...p, arquivos: (job.arquivos || []).map((a) => a.nome),
    }, null, 2), "utf8");
    writeFileSync(marcador, JSON.stringify({ id: job.id, chat_id: job.chat_id, baixado_em: new Date().toISOString() }, null, 2), "utf8");

    console.log(`✔ ${nome}: ${ok}/${(job.arquivos || []).length} arquivo(s) na pasta.`);
    criadas.push(pasta);
  }
  return criadas;
}

// ── 2) Devolver o que o Claude terminou ────────────────────────────────────
// O Claude, ao concluir, deixa um _PRONTO.txt na pasta com o texto do aviso.
async function devolverProntos() {
  if (!existsSync(PASTA_COMERCIAL)) return;
  for (const entrada of readdirSync(PASTA_COMERCIAL, { withFileTypes: true })) {
    if (!entrada.isDirectory()) continue;
    const pasta = join(PASTA_COMERCIAL, entrada.name);
    const pronto = join(pasta, "_PRONTO.txt");
    const marcador = join(pasta, "_JOB.json");
    if (!existsSync(pronto) || !existsSync(marcador)) continue;
    try {
      const { id } = JSON.parse(readFileSync(marcador, "utf8"));
      const texto = readFileSync(pronto, "utf8").slice(0, 3000);
      if (await fecharJob(id, texto)) {
        writeFileSync(join(pasta, "_AVISADO.txt"), new Date().toISOString(), "utf8");
        // não apaga o _PRONTO.txt: fica como histórico do que foi avisado
        console.log(`📨 ${entrada.name}: avisado no grupo.`);
      }
    } catch (e) { console.warn(`✖ ${entrada.name}: ${e.message}`); }
  }
}

console.log(`Ponte Comercial — ${SITE}`);
console.log(`Pasta: ${PASTA_COMERCIAL}\n`);
try {
  await puxar();
  await devolverProntos();
  console.log("\nPronto.");
} catch (e) {
  console.error(`\n✖ Falhou: ${e.message}`);
  process.exit(1);
}
