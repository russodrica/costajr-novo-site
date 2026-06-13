// QA E2E do módulo Orçamentos (Fase 1) — base de serviços + parâmetros BDI.
// Requer migration 036 aplicada e o módulo deployado. BASE override por env QA_BASE.
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split(/\r?\n/).filter(l => l.includes("=") && !l.startsWith("#"))
    .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);
const SB = env.SUPABASE_URL || env.PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
const BASE = process.env.QA_BASE || "https://www.costajr.com.br";
const hash = s => createHash("sha256").update(s + "::cjr-manut-salt-v1").digest("hex");
const sb = async (path, opts = {}) => {
  const res = await fetch(`${SB}/rest/v1/${path}`, { ...opts, headers: { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json", prefer: "return=representation", ...(opts.headers || {}) } });
  const t = await res.text();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
};
const results = [];
const check = (nome, ok, det = "") => { results.push(ok); console.log(`${ok ? "✅" : "❌"} ${nome}${det ? " — " + det : ""}`); };

const SENHA = "QaOrc#2026";
const adminEmail = `qa.orc.admin.${Date.now()}@costajr.com.br`;
const codigoTeste = `QA${Date.now().toString().slice(-7)}`;
let adminId, paramChave;

try {
  const [adm] = await sb("portal_profiles", { method: "POST", body: JSON.stringify({ id: randomUUID(), email: adminEmail, full_name: "QA Orc Admin", role: "admin", roles: ["admin"], approval_status: "approved", senha_hash: hash(SENHA) }) });
  adminId = adm.id;

  const ar = await fetch(`${BASE}/api/admin/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: adminEmail, senha: SENHA }) });
  const cookie = (ar.headers.get("set-cookie") || "").split(";")[0];
  const H = { cookie, "content-type": "application/json" };
  check("Login admin", ar.ok && cookie.startsWith("admin_token="));

  // ── Listagem + paginação ──
  const l1 = await fetch(`${BASE}/api/admin/orcamentos/servicos?pageSize=10&page=1`, { headers: H });
  const ld = await l1.json();
  check("Listar serviços (paginado)", l1.ok && Array.isArray(ld.itens) && typeof ld.total === "number", `total=${ld.total}`);
  check("Base importada (>1500 itens)", (ld.total || 0) > 1500, `total=${ld.total}`);

  // ── Filtro por disciplina ──
  const lf = await fetch(`${BASE}/api/admin/orcamentos/servicos?disciplina=${encodeURIComponent("Hidráulica")}&pageSize=5`, { headers: H });
  const lfd = await lf.json();
  check("Filtro por disciplina", lf.ok && lfd.itens.every(s => s.disciplina === "Hidráulica"));

  // ── Filtro pendências de auditoria ──
  const lp = await fetch(`${BASE}/api/admin/orcamentos/servicos?status=pendentes&pageSize=5`, { headers: H });
  const lpd = await lp.json();
  check("Filtro pendências de auditoria", lp.ok && lpd.itens.every(s => s.status_auditoria !== "OK"));

  // ── Busca textual ──
  const lb = await fetch(`${BASE}/api/admin/orcamentos/servicos?busca=demoli&pageSize=5`, { headers: H });
  const lbd = await lb.json();
  check("Busca textual", lb.ok && lbd.itens.length > 0);

  // ── Criar serviço ──
  const c1 = await fetch(`${BASE}/api/admin/orcamentos/servicos`, { method: "POST", headers: H, body: JSON.stringify({ codigo: codigoTeste, disciplina: "Civil", grupo: "QA", descricao: "Serviço de teste QA", unidade: "un", custo_material: 10.5, custo_mao_obra: 5.25 }) });
  const c1d = await c1.json();
  check("Criar serviço", c1.ok && c1d.codigo === codigoTeste);
  check("Custo total calculado", Number(c1d.custo_total) === 15.75, `custo_total=${c1d.custo_total}`);

  // ── Código duplicado → 409 ──
  const cdup = await fetch(`${BASE}/api/admin/orcamentos/servicos`, { method: "POST", headers: H, body: JSON.stringify({ codigo: codigoTeste, disciplina: "Civil", descricao: "dup" }) });
  check("Código duplicado bloqueado (409)", cdup.status === 409);

  // ── Editar ──
  const p1 = await fetch(`${BASE}/api/admin/orcamentos/servicos/${codigoTeste}`, { method: "PATCH", headers: H, body: JSON.stringify({ custo_material: 20, descricao: "Serviço QA editado" }) });
  const p1d = await p1.json();
  check("Editar serviço", p1.ok && Number(p1d.custo_material) === 20 && Number(p1d.custo_total) === 25.25);

  // ── Desativar (soft) ──
  const dl = await fetch(`${BASE}/api/admin/orcamentos/servicos/${codigoTeste}`, { method: "DELETE", headers: H });
  check("Desativar serviço (soft)", dl.ok);
  const verif = await sb(`orc_servicos?codigo=eq.${codigoTeste}&select=ativo`);
  check("Soft-delete preserva registro", verif.length === 1 && verif[0].ativo === false);

  // ── CSRF: POST sem content-type json deve falhar ──
  const csrf = await fetch(`${BASE}/api/admin/orcamentos/servicos`, { method: "POST", headers: { cookie }, body: "{}" });
  check("CSRF bloqueia POST sem JSON", csrf.status === 403 || csrf.status === 400);

  // ── Parâmetros BDI (usa chave descartável p/ NÃO mutar o BDI real de produção) ──
  const pr = await fetch(`${BASE}/api/admin/orcamentos/parametros`, { headers: H });
  const prd = await pr.json();
  check("Listar parâmetros BDI", pr.ok && prd.length >= 15);
  paramChave = `qa_${Date.now()}`;
  await sb("orc_parametros_bdi", { method: "POST", body: JSON.stringify({ chave: paramChave, rotulo: "QA Teste", valor: 0.10, grupo: "alcada", ordem: 999 }) });
  const pu = await fetch(`${BASE}/api/admin/orcamentos/parametros`, { method: "PATCH", headers: H, body: JSON.stringify({ itens: [{ chave: paramChave, valor: 0.16 }] }) });
  check("Atualizar parâmetro BDI", pu.ok);
  const prd2 = await (await fetch(`${BASE}/api/admin/orcamentos/parametros`, { headers: H })).json();
  check("Valor persistido", Number(prd2.find(p => p.chave === paramChave)?.valor) === 0.16);

  // ── Auth: sem cookie → 401 ──
  const noauth = await fetch(`${BASE}/api/admin/orcamentos/servicos`);
  check("Sem auth → 401", noauth.status === 401);

} catch (e) {
  check("Execução sem exceção", false, e.message);
} finally {
  // Limpeza
  try { await sb(`orc_servicos?codigo=eq.${codigoTeste}`, { method: "DELETE" }); } catch {}
  if (paramChave) { try { await sb(`orc_parametros_bdi?chave=eq.${paramChave}`, { method: "DELETE" }); } catch {} }
  if (adminId) { try { await sb(`portal_profiles?id=eq.${adminId}`, { method: "DELETE" }); } catch {} }
}

const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} checks passaram`);
process.exit(ok === results.length ? 0 : 1);
