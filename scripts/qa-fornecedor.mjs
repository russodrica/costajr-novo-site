// QA E2E do acesso FORNECEDOR (externo) — roda contra produção (ou QA_BASE).
// Cria (ou reusa) um fornecedor de TESTE direto no banco, loga via /api/admin/login
// e prova: (ALLOW) doc-empresa view empresa + extratos, download OK;
// (DENY) todo o resto — páginas, APIs admin, APIs portal, mutações, compartilhamento.
// Ao final BLOQUEIA o fornecedor de teste (approval rejected).
// Uso:  node scripts/qa-fornecedor.mjs           (produção)
//       QA_BASE=http://localhost:4321 node scripts/qa-fornecedor.mjs
import fs from "fs";
import crypto from "crypto";

const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split(/\r?\n/).filter(l => l.includes("=")).map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const SU = env.PUBLIC_SUPABASE_URL.replace(/\/$/, "");
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const BASE = process.env.QA_BASE || "https://www.costajr.com.br";
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", "User-Agent": "cjr-cli/1.0" };

const EMAIL = "fornecedor.teste@qa.costajr.com.br";
const SENHA = "QaForn" + crypto.randomBytes(4).toString("hex");
const SALT = "::cjr-manut-salt-v1"; // igual lib/auth.ts
const sha = (s) => crypto.createHash("sha256").update(s + SALT).digest("hex");

let pass = 0, fail = 0;
const ok = (nome, cond, extra = "") => { if (cond) { pass++; console.log(`  ✓ ${nome}`); } else { fail++; console.log(`  ✗ FALHOU: ${nome} ${extra}`); } };

const rest = (q) => fetch(`${SU}/rest/v1/${q}`, { headers: H }).then(r => r.json());

// ── seed: cria/reseta o fornecedor de teste direto no banco ──
async function seed() {
  const [ja] = await rest(`portal_profiles?email=eq.${encodeURIComponent(EMAIL)}&select=id`);
  const body = { role: "fornecedor", roles: ["fornecedor"], approval_status: "approved", senha_hash: sha(SENHA), display_name: "Fornecedor QA (teste)", empresa: "QA Ltda", token_version: 0 };
  if (ja) {
    const u = await fetch(`${SU}/rest/v1/portal_profiles?id=eq.${ja.id}`, { method: "PATCH", headers: H, body: JSON.stringify(body) });
    if (!u.ok) throw new Error("PATCH seed: " + (await u.text()));
    return ja.id;
  }
  const c = await fetch(`${SU}/rest/v1/portal_profiles`, { method: "POST", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify({ email: EMAIL, ...body }) });
  if (!c.ok) throw new Error("INSERT seed (a migration 077 rodou?): " + (await c.text()));
  const [row] = await c.json();
  return row.id;
}

let COOKIE = "";
const req = (path, opts = {}) => fetch(BASE + path, { redirect: "manual", ...opts, headers: { cookie: COOKIE, "content-type": "application/json", ...(opts.headers || {}) } });

(async () => {
  console.log(`QA fornecedor — base ${BASE}`);
  const fornId = await seed();
  console.log(`seed ok (${fornId})`);

  // IDs reais p/ os testes de download
  const VEDADAS = ["Contratos", "Clientes", "Consórcios", "Seguros"];
  const arqs = await rest(`doc_empresa_arquivos?select=id,doc_id,doc_empresa(categoria,arquivado)&limit=2000`);
  const arqEmpresa = arqs.find(a => a.doc_empresa && !a.doc_empresa.arquivado && !VEDADAS.includes(a.doc_empresa.categoria));
  const arqVedado = arqs.find(a => a.doc_empresa && VEDADAS.includes(a.doc_empresa.categoria));
  const [extrato] = await rest(`doc_extratos_bancarios?select=id&limit=1`);

  // ── login ──
  const lg = await fetch(BASE + "/api/admin/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: EMAIL, senha: SENHA }) });
  ok("login do fornecedor (200)", lg.status === 200, `status=${lg.status}`);
  const m = (lg.headers.get("set-cookie") || "").match(/admin_token=([^;]+)/);
  ok("cookie admin_token emitido", !!m);
  if (!m) { console.log("sem cookie — abortando"); process.exit(1); }
  COOKIE = `admin_token=${m[1]}`;

  console.log("\n── ALLOW (escopo do fornecedor) ──");
  const pDoc = await req("/admin/doc-empresa"); const hDoc = await pDoc.text();
  ok("página doc-empresa abre (200)", pDoc.status === 200, `status=${pDoc.status}`);
  ok("doc-empresa SEM 'Acesso restrito'", !hDoc.includes("Acesso restrito"));
  ok("doc-empresa NÃO vaza contratos", !hDoc.includes("Contratos de Consultoria") && !/"categoria":"Contratos"/.test(hDoc));
  ok("doc-empresa NÃO vaza Seguros", !/"categoria":"Seguros"/.test(hDoc));
  ok("doc-empresa NÃO vaza valor_mensal com número", !/"valor_mensal":\s*[0-9]/.test(hDoc));

  const pBanc = await req("/admin/doc-bancarios"); const hBanc = await pBanc.text();
  ok("página doc-bancarios abre (200)", pBanc.status === 200, `status=${pBanc.status}`);
  ok("doc-bancarios SEM 'Acesso restrito'", !hBanc.includes("Acesso restrito"));
  ok("doc-bancarios esconde aba Faturas", !hBanc.includes("Faturas de Cartão"));
  ok("doc-bancarios esconde aba Empréstimos", !hBanc.includes("Empréstimos &amp; Financiamentos") && !hBanc.includes("Empréstimos & Financiamentos"));

  if (arqEmpresa) { const d = await req(`/api/admin/doc-empresa/arquivos/${arqEmpresa.id}`); ok("download de doc da EMPRESA (302)", d.status === 302, `status=${d.status}`); }
  else console.log("  (sem arquivo de empresa p/ testar download)");
  if (extrato) { const d = await req(`/api/admin/doc-empresa/extratos/${extrato.id}`); ok("download de EXTRATO (302)", d.status === 302, `status=${d.status}`); }
  else console.log("  (sem extrato p/ testar download)");

  console.log("\n── DENY (fora do escopo) ──");
  // páginas restritas
  for (const [path, nome] of [["/admin/rh", "RH"], ["/admin/financeiro", "Financeiro"], ["/admin/ativos", "Ativos"], ["/admin/orcamentos", "Orçamentos (BDI!)"], ["/admin/orcamentos/parametros", "Parâmetros BDI"], ["/admin/membros", "Membros"], ["/admin/fornecedores", "Fornecedores"], ["/admin/comercial", "Comercial"]]) {
    const p = await req(path); const h = p.status === 200 ? await p.text() : "";
    const bloqueada = p.status === 302 || (p.status === 200 && h.includes("Acesso restrito"));
    ok(`página ${nome} BLOQUEADA`, bloqueada, `status=${p.status}`);
    if (path.includes("orcamentos")) ok(`  ${nome} NÃO vaza params de BDI`, !/orc_parametros_bdi|grau_risco|custo_indireto|contingencia/i.test(h));
  }
  // home redireciona p/ doc-empresa
  const home = await req("/admin"); ok("/admin (home) redireciona", home.status === 302 && (home.headers.get("location") || "").includes("doc-empresa"), `status=${home.status} loc=${home.headers.get("location")}`);

  // APIs admin fora da allowlist → 403 (cerca)
  for (const [path, nome] of [["/api/admin/rh/colaboradores", "GET rh/colaboradores"], ["/api/admin/fin/resumo", "GET fin/resumo"], ["/api/admin/ativos/export", "GET ativos/export"]]) {
    const r = await req(path); ok(`API ${nome} 403 (cerca)`, r.status === 403, `status=${r.status}`);
  }
  // APIs portal → 403/401 (requireAdmin recusa fornecedor / cerca)
  for (const [path, nome] of [["/api/portal/notificacoes", "portal/notificacoes"], ["/api/portal/perfil", "portal/perfil"]]) {
    const r = await req(path); ok(`API ${nome} negada`, r.status === 403 || r.status === 401, `status=${r.status}`);
  }
  // gestão de fornecedores por um fornecedor → 403
  const gForn = await req("/api/admin/fornecedores"); ok("GET fornecedores (gestão) 403", gForn.status === 403, `status=${gForn.status}`);
  const cForn = await req("/api/admin/fornecedores", { method: "POST", body: JSON.stringify({ nome: "x", email: "x@x.com" }) }); ok("POST criar fornecedor 403", cForn.status === 403, `status=${cForn.status}`);

  console.log("\n── DENY: mutações e compartilhamento ──");
  // mutação em doc-empresa (criar doc) → 403
  const novoDoc = await req("/api/admin/doc-empresa", { method: "POST", body: JSON.stringify({ nome: "hack", categoria: "Documentos da Empresa" }) });
  ok("POST criar documento 403", novoDoc.status === 403, `status=${novoDoc.status}`);
  // upload-url (inserir arquivo) → 403 — precisa de um doc_id; usa o do arqEmpresa
  if (arqEmpresa) { const up = await req(`/api/admin/doc-empresa/${arqEmpresa.doc_id}/upload-url`, { method: "POST", body: JSON.stringify({ nome: "x.pdf" }) }); ok("POST upload-url 403", up.status === 403, `status=${up.status}`); }
  // DELETE de extrato (mutação em rota da allowlist) → 403
  if (extrato) { const del = await req(`/api/admin/doc-empresa/extratos/${extrato.id}`, { method: "DELETE" }); ok("DELETE extrato 403 (mutação)", del.status === 403, `status=${del.status}`); }
  // compartilhamento por WhatsApp/e-mail → 403 (cerca)
  const zap = await req("/api/admin/doc-empresa/whatsapp-links", { method: "POST", body: JSON.stringify({ arquivo_ids: arqEmpresa ? [arqEmpresa.id] : [] }) });
  ok("POST whatsapp-links 403 (cerca)", zap.status === 403, `status=${zap.status}`);
  const mail = await req("/api/admin/doc-empresa/enviar-email", { method: "POST", body: JSON.stringify({ to: "x@x.com", arquivo_ids: [] }) });
  ok("POST enviar-email 403 (cerca)", mail.status === 403, `status=${mail.status}`);

  console.log("\n── DENY: download de categoria VEDADA (contrato/seguro) ──");
  if (arqVedado) { const d = await req(`/api/admin/doc-empresa/arquivos/${arqVedado.id}`); ok("download de CONTRATO/SEGURO 403", d.status === 403, `status=${d.status}`); }
  else console.log("  (sem arquivo de contrato/seguro p/ testar)");

  console.log("\n── revogação: bloquear derruba a sessão na hora ──");
  await fetch(`${SU}/rest/v1/portal_profiles?id=eq.${fornId}`, { method: "PATCH", headers: H, body: JSON.stringify({ approval_status: "rejected" }) });
  const posBloqueio = await req("/admin/doc-empresa");
  ok("após BLOQUEIO, doc-empresa redireciona p/ login", posBloqueio.status === 302 && (posBloqueio.headers.get("location") || "").includes("login"), `status=${posBloqueio.status} loc=${posBloqueio.headers.get("location")}`);
  const dlPosBloqueio = arqEmpresa ? await req(`/api/admin/doc-empresa/arquivos/${arqEmpresa.id}`) : { status: 401 };
  ok("após BLOQUEIO, download 401", dlPosBloqueio.status === 401, `status=${dlPosBloqueio.status}`);

  console.log(`\n=== RESULTADO: ${pass} ok / ${fail} falhas ===`);
  console.log("(fornecedor de teste ficou BLOQUEADO no banco)");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("ERRO:", e.message); process.exit(2); });
