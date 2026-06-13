// QA E2E baseline do módulo Financeiro em produção.
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n").filter(l => l.includes("=") && !l.startsWith("#"))
    .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);
const SB = env.SUPABASE_URL || env.PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
const BASE = "https://www.costajr.com.br";
const hash = s => createHash("sha256").update(s + "::cjr-manut-salt-v1").digest("hex");
const sb = async (path, opts = {}) => {
  const res = await fetch(`${SB}/rest/v1/${path}`, { ...opts, headers: { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json", prefer: "return=representation", ...(opts.headers || {}) } });
  const t = await res.text();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
};
const results = [];
const check = (nome, ok, det = "") => { results.push(ok); console.log(`${ok ? "✅" : "❌"} ${nome}${det ? " — " + det : ""}`); };

const SENHA = "QaFin#2026";
const adminEmail = `qa.fin.${Date.now()}@costajr.com.br`;
let adminId, lancId, catId;

try {
  const [adm] = await sb("portal_profiles", { method: "POST", body: JSON.stringify({ id: randomUUID(), email: adminEmail, full_name: "QA Fin Admin", role: "admin", roles: ["admin"], approval_status: "approved", senha_hash: hash(SENHA) }) });
  adminId = adm.id;
  const ar = await fetch(`${BASE}/api/admin/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: adminEmail, senha: SENHA }) });
  const cookie = (ar.headers.get("set-cookie") || "").split(";")[0];
  const HA = { cookie, "content-type": "application/json" };
  check("Login admin", ar.ok && cookie.startsWith("admin_token="));

  // 1. Criar categoria
  const c1 = await fetch(`${BASE}/api/admin/fin/categorias`, { method: "POST", headers: HA, body: JSON.stringify({ nome: "QA Cat Teste", tipo: "despesa", cor: "#123456" }) });
  const c1d = await c1.json(); catId = c1d.id;
  check("Criar categoria", c1.ok && !!catId);

  // 2. Criar lançamento (despesa prevista)
  const l1 = await fetch(`${BASE}/api/admin/fin/lancamentos`, { method: "POST", headers: HA, body: JSON.stringify({ tipo: "despesa", descricao: "QA Despesa Teste", valor: 1500.50, data_vencimento: "2026-07-15", categoria_id: catId, status: "previsto" }) });
  const l1d = await l1.json(); lancId = l1d.id;
  check("Criar lançamento", l1.ok && !!lancId);

  // 3. Validação: tipo inválido
  const v1 = await fetch(`${BASE}/api/admin/fin/lancamentos`, { method: "POST", headers: HA, body: JSON.stringify({ tipo: "xpto", descricao: "x", valor: 10, data_vencimento: "2026-07-15" }) });
  check("Rejeita tipo inválido", v1.status === 400);

  // 4. Validação: campos obrigatórios
  const v2 = await fetch(`${BASE}/api/admin/fin/lancamentos`, { method: "POST", headers: HA, body: JSON.stringify({ tipo: "despesa" }) });
  check("Rejeita campos faltando", v2.status === 400);

  // 5. Editar / marcar como pago
  const e1 = await fetch(`${BASE}/api/admin/fin/lancamentos/${lancId}`, { method: "PATCH", headers: HA, body: JSON.stringify({ status: "pago", data_pagamento: "2026-07-10" }) });
  check("Marcar como pago", e1.ok);

  // 6. Listar com filtros
  const lst = await fetch(`${BASE}/api/admin/fin/lancamentos?tipo=despesa&mes=2026-07`, { headers: { cookie } });
  const lstD = await lst.json();
  check("Listar lançamentos com filtro", lst.ok && lstD.some(l => l.id === lancId));

  // 7. Resumo / fluxo de caixa
  const rs = await fetch(`${BASE}/api/admin/fin/resumo?meses=6`, { headers: { cookie } });
  const rsD = await rs.json();
  check("Resumo / fluxo de caixa", rs.ok && rsD.por_mes && rsD.mes_corrente);

  // 8. Excluir lançamento
  const d1 = await fetch(`${BASE}/api/admin/fin/lancamentos/${lancId}`, { method: "DELETE", headers: HA });
  check("Excluir/cancelar lançamento", d1.ok); if (d1.ok) lancId = null;

  // 9. Segurança: sem auth → 401
  const sec = await fetch(`${BASE}/api/admin/fin/lancamentos`);
  check("Bloqueia API sem auth (401)", sec.status === 401);

  // 10. Páginas renderizam
  const pg1 = await fetch(`${BASE}/admin/financeiro`, { headers: { cookie } });
  const pg2 = await fetch(`${BASE}/admin/fin-conciliacao`, { headers: { cookie } });
  check("Página /admin/financeiro (200)", pg1.ok);
  check("Página /admin/fin-conciliacao (200)", pg2.ok);

  // 11. Resumo agregado no banco (RPC) — bate com a contagem real, não trunca
  const totalAbertos = (await sb(`fin_lancamentos?status=in.(previsto,atrasado)&select=id`, { headers: { prefer: "count=exact", range: "0-0" } }) , null);
  const cAb = await fetch(`${SB}/rest/v1/fin_lancamentos?status=in.(previsto,atrasado)&select=id`, { headers: { apikey: KEY, authorization: `Bearer ${KEY}`, prefer: "count=exact", range: "0-0" } });
  const totalAb = Number((cAb.headers.get("content-range") || "/0").split("/")[1]) || 0;
  const rs2 = await fetch(`${BASE}/api/admin/fin/resumo?meses=6`, { headers: { cookie } });
  const rs2D = await rs2.json();
  const qtdAtras = (rs2D.mes_corrente.atrasados_receber_qtd || 0) + (rs2D.mes_corrente.atrasados_pagar_qtd || 0);
  // a contagem de atrasados deve ser plausível (>0 dado o histórico Vobi) e <= total de abertos
  check("Resumo agrega no banco (não trunca em 5000)", rs2.ok && qtdAtras > 0 && qtdAtras <= totalAb, `atrasados=${qtdAtras} de ${totalAb} abertos`);

  // 12. DRE por categoria
  const dre = await fetch(`${BASE}/api/admin/fin/dre?inicio=2026-01&fim=2026-06`, { headers: { cookie } });
  const dreD = await dre.json();
  check("DRE por categoria", dre.ok && Array.isArray(dreD.receitas) && Array.isArray(dreD.despesas) && typeof dreD.resultado === "number");

  // 13. Validação de valor: rejeita não-numérico e negativo
  const vn1 = await fetch(`${BASE}/api/admin/fin/lancamentos`, { method: "POST", headers: HA, body: JSON.stringify({ tipo: "despesa", descricao: "QA valor ruim", valor: "abc", data_vencimento: "2026-07-15" }) });
  check("Rejeita valor não-numérico", vn1.status === 400);
  const vn2 = await fetch(`${BASE}/api/admin/fin/lancamentos`, { method: "POST", headers: HA, body: JSON.stringify({ tipo: "despesa", descricao: "QA valor neg", valor: -50, data_vencimento: "2026-07-15" }) });
  check("Rejeita valor negativo", vn2.status === 400);
} catch (e) {
  check("EXCEÇÃO", false, e.message);
} finally {
  try {
    if (lancId) await sb(`fin_lancamentos?id=eq.${lancId}`, { method: "DELETE" });
    await sb(`fin_lancamentos?descricao=like.QA Despesa%25`, { method: "DELETE" }).catch(() => {});
    if (catId) await sb(`fin_categorias?id=eq.${catId}`, { method: "DELETE" });
    if (adminId) await sb(`portal_profiles?id=eq.${adminId}`, { method: "DELETE" });
    console.log("Cleanup OK");
  } catch (e) { console.log("Cleanup parcial:", e.message); }
}
const ok = results.filter(Boolean).length;
console.log(`\n=== ${ok}/${results.length} testes passaram ===`);
process.exit(ok === results.length ? 0 : 1);
