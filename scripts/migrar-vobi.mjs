// ============================================================================
// Migra os dados financeiros da Vobi para o Supabase (módulo Financeiro).
//
// O que migra:
//   1. Categorias financeiras  → fin_categorias   (income→receita, expense→despesa)
//   2. Projetos (refurbish)    → obras
//   3. Pagamentos + parcelas   → fin_lancamentos  (1 parcela = 1 lançamento)
//      com fornecedor/cliente, categoria, obra e status (pago/previsto/cancelado)
//
// Idempotente: usa a coluna vobi_id (migration 024) para nunca duplicar.
// Token da Vobi dura 5 min — o script renova automaticamente.
//
// Requer no .env:  VOBI_UUID=...  VOBI_SECRET=...
// Uso:  node scripts/migrar-vobi.mjs
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

const SUPABASE_URL = env.PUBLIC_SUPABASE_URL;
const SB_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const VOBI_UUID = env.VOBI_UUID;
const VOBI_SECRET = env.VOBI_SECRET;

// Modo arquivo: node scripts/migrar-vobi.mjs caminho/para/vobi-export.json
// (export gerado pelo navegador logado na Vobi — ver CLAUDE.md)
const ARQUIVO_EXPORT = process.argv[2] || null;
if (!ARQUIVO_EXPORT && (!VOBI_UUID || !VOBI_SECRET)) {
  console.error("Uso: node scripts/migrar-vobi.mjs <vobi-export.json>");
  console.error("  ou defina VOBI_UUID e VOBI_SECRET no .env para usar a API direto.");
  process.exit(1);
}

const VOBI = "https://api.vobi.com.br/v2";

// ─── Auth Vobi (token de 5 min, renova sozinho) ─────────────────────────────
let _token = null;
let _tokenAt = 0;
async function vobiToken() {
  if (_token && Date.now() - _tokenAt < 4 * 60 * 1000) return _token;
  const basic = Buffer.from(`${VOBI_UUID}:${VOBI_SECRET}`).toString("base64");
  const r = await fetch(`${VOBI}/auth/token`, { method: "POST", headers: { authorization: `Basic ${basic}` } });
  if (!r.ok) throw new Error(`Auth Vobi falhou: HTTP ${r.status} ${await r.text()}`);
  const j = await r.json();
  _token = j.jwt || j.token;
  _tokenAt = Date.now();
  return _token;
}

async function vobiGet(path) {
  const token = await vobiToken();
  const r = await fetch(`${VOBI}${path}`, { headers: { authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`GET ${path}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

/** Busca todas as páginas de um endpoint de listagem (limit máx 500). */
async function vobiAll(endpoint, extra = "") {
  const out = [];
  let offset = 0;
  for (;;) {
    const j = await vobiGet(`/${endpoint}?limit=500&offset=${offset}${extra}`);
    const rows = j.rows || j.data || (Array.isArray(j) ? j : []);
    out.push(...rows);
    process.stdout.write(`\r  ${endpoint}: ${out.length} registros...`);
    if (rows.length < 500) break;
    offset += 500;
  }
  console.log();
  return out;
}

// ─── Supabase ────────────────────────────────────────────────────────────────
const sbHeaders = { apikey: SB_KEY, authorization: `Bearer ${SB_KEY}`, "content-type": "application/json" };

async function sbUpsert(table, rows, conflict = "vobi_id") {
  if (!rows.length) return 0;
  let total = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const lote = rows.slice(i, i + 500);
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${conflict}`, {
      method: "POST",
      headers: { ...sbHeaders, prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(lote),
    });
    if (!r.ok) throw new Error(`Upsert ${table}: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
    total += lote.length;
  }
  return total;
}

async function sbSelect(table, query) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: sbHeaders });
  if (!r.ok) throw new Error(`Select ${table}: HTTP ${r.status}`);
  return r.json();
}

// ─── Migração ────────────────────────────────────────────────────────────────

function d(s) { return s ? String(s).slice(0, 10) : null; }

(async () => {
  console.log("Migração Vobi → Supabase");
  console.log("Destino:", SUPABASE_URL);

  let exportado = null;
  if (ARQUIVO_EXPORT) {
    exportado = JSON.parse(readFileSync(ARQUIVO_EXPORT, "utf8"));
    console.log("Fonte: arquivo", ARQUIVO_EXPORT);
  } else {
    await vobiToken();
    console.log("Fonte: API Vobi (autenticado)\n");
  }

  // 1) Categorias financeiras
  console.log("■ Categorias financeiras");
  const cats = exportado ? exportado.categorias : await vobiAll("financial-category");
  const catPorId = new Map(cats.map((c) => [c.id, c]));
  const catRows = cats.filter((c) => c.isActive !== false).map((c) => {
    const pai = c.idParent ? catPorId.get(c.idParent) : null;
    return {
      vobi_id: `vobi-${c.id}`,
      nome: pai ? `${pai.name} / ${c.name}` : c.name,
      tipo: c.billType === "income" ? "receita" : "despesa",
      cor: c.billType === "income" ? "#16A34A" : "#DC2626",
      ativo: true,
    };
  });
  await sbUpsert("fin_categorias", catRows);
  console.log(`  ✔ ${catRows.length} categorias sincronizadas`);

  // 2) Projetos → obras
  console.log("\n■ Projetos (refurbish) → obras");
  const projetos = exportado ? exportado.projetos : await vobiAll("refurbish");
  const obraRows = projetos.map((p) => ({
    vobi_id: `vobi-${p.id}`,
    nome: p.name || `Projeto ${p.id}`,
    endereco: [p.street, p.number, p.complement].filter(Boolean).join(", ") || null,
    cidade: p.city || null,
    uf: p.state || null,
    status: p.archivedDate ? "cancelada" : p.winnerDate ? "ativa" : "planejada",
    data_inicio: d(p.startDate),
    data_fim_prevista: d(p.predictionDate),
    valor_contrato: p.budget ?? null,
    observacoes: "Importado da Vobi",
    criado_por: "migracao-vobi",
  }));
  await sbUpsert("obras", obraRows);
  console.log(`  ✔ ${obraRows.length} obras sincronizadas`);

  // mapas vobi_id → id supabase
  const catsSb = await sbSelect("fin_categorias", "select=id,vobi_id&vobi_id=not.is.null&limit=2000");
  const mapaCat = new Map(catsSb.map((c) => [c.vobi_id, c.id]));
  const obrasSb = await sbSelect("obras", "select=id,vobi_id&vobi_id=not.is.null&limit=5000");
  const mapaObra = new Map(obrasSb.map((o) => [o.vobi_id, o.id]));

  // 3) Fornecedores e clientes (só para nomes)
  console.log("\n■ Fornecedores e clientes (referência de nomes)");
  const fornecedores = exportado ? exportado.fornecedores : await vobiAll("supplier");
  const clientes = exportado ? exportado.clientes : await vobiAll("company-customer");
  const nomeFornecedor = new Map(fornecedores.map((f) => [f.id, f.name || f.companyName || f.fantasyName]));
  const nomeCliente = new Map(clientes.map((c) => [c.id, c.name || c.companyName]));

  // 4) Pagamentos + parcelas → fin_lancamentos
  console.log("\n■ Pagamentos e parcelas");
  const pagamentos = exportado ? exportado.pagamentos : await vobiAll("payment");
  const pagPorId = new Map(pagamentos.map((p) => [p.id, p]));
  const parcelas = exportado ? exportado.parcelas : await vobiAll("installment");

  const parcelasPorPagamento = new Map();
  for (const i of parcelas) {
    if (!parcelasPorPagamento.has(i.idPayment)) parcelasPorPagamento.set(i.idPayment, 0);
    parcelasPorPagamento.set(i.idPayment, parcelasPorPagamento.get(i.idPayment) + 1);
  }

  let pulados = 0;
  const lancRows = [];
  for (const i of parcelas) {
    const pag = pagPorId.get(i.idPayment);
    if (!pag) { pulados++; continue; }
    // transferências entre contas e saldos iniciais não viram lançamento
    if (pag.billType !== "income" && pag.billType !== "expense") { pulados++; continue; }
    if (pag.idPaymentStatus === 1) { pulados++; continue; } // rascunho

    const st = i.idInstallmentStatus;
    const status = st === 12 ? "cancelado" : st >= 2 && st <= 11 ? "pago" : "previsto";
    const totalParcelas = parcelasPorPagamento.get(i.idPayment) || 1;
    const sufixo = totalParcelas > 1 ? ` (parcela ${i.number}/${totalParcelas})` : "";

    lancRows.push({
      vobi_id: `vobi-${i.id}`,
      tipo: pag.billType === "income" ? "receita" : "despesa",
      descricao: `${pag.name || "Lançamento Vobi"}${sufixo}`,
      categoria_id: pag.idFinancialCategory ? mapaCat.get(`vobi-${pag.idFinancialCategory}`) ?? null : null,
      valor: i.price ?? i.originalValue ?? 0,
      data_vencimento: d(i.dueDate) || d(pag.billingDate) || new Date().toISOString().slice(0, 10),
      data_pagamento: status === "pago" ? d(i.paidDate) || d(i.asaasPaidDate) : null,
      status,
      fornecedor_cliente: pag.billType === "expense"
        ? (nomeFornecedor.get(pag.idSupplier) ?? null)
        : (nomeCliente.get(pag.idCompanyCustomer) ?? null),
      obra_id: pag.idRefurbish ? mapaObra.get(`vobi-${pag.idRefurbish}`) ?? null : null,
      observacoes: [pag.observation, pag.annotation].filter(Boolean).join(" | ") || null,
      criado_por: "migracao-vobi",
    });
  }
  // dedupe por vobi_id (a paginação da API pode trazer sobreposições)
  const lancUnicos = [...new Map(lancRows.map((l) => [l.vobi_id, l])).values()];
  if (lancUnicos.length !== lancRows.length) console.log(`  (${lancRows.length - lancUnicos.length} duplicados removidos)`);
  await sbUpsert("fin_lancamentos", lancUnicos);
  console.log(`  ✔ ${lancRows.length} lançamentos sincronizados (${pulados} pulados: rascunhos/transferências/órfãos)`);

  // Resumo
  const receitas = lancRows.filter((l) => l.tipo === "receita");
  const despesas = lancRows.filter((l) => l.tipo === "despesa");
  const soma = (a) => a.reduce((s, l) => s + Number(l.valor || 0), 0);
  console.log("\n──────────────────────────────────────────");
  console.log(`✅ Migração concluída:`);
  console.log(`   Categorias: ${catRows.length} | Obras: ${obraRows.length}`);
  console.log(`   Receitas: ${receitas.length} lançamentos = R$ ${soma(receitas).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`);
  console.log(`   Despesas: ${despesas.length} lançamentos = R$ ${soma(despesas).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`);
  console.log(`\nVeja em https://costajr.com.br/admin/financeiro`);
})().catch((e) => { console.error("\n✘ ERRO:", e.message); process.exit(1); });
