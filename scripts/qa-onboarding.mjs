// QA E2E do Onboarding em produção — fluxo do colaborador + relatório do admin.
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

const SENHA = "QaOnb#2026";
const colabEmail = `qa.onb.colab.${Date.now()}@costajr.com.br`;
const adminEmail = `qa.onb.admin.${Date.now()}@costajr.com.br`;
let colabId, adminId;

try {
  const [col] = await sb("portal_profiles", { method: "POST", body: JSON.stringify({ id: randomUUID(), email: colabEmail, full_name: "QA Onb Colab", role: "operacional", roles: ["operacional"], approval_status: "approved", senha_hash: hash(SENHA) }) });
  colabId = col.id;
  const [adm] = await sb("portal_profiles", { method: "POST", body: JSON.stringify({ id: randomUUID(), email: adminEmail, full_name: "QA Onb Admin", role: "admin", roles: ["admin"], approval_status: "approved", senha_hash: hash(SENHA) }) });
  adminId = adm.id;

  // login colaborador
  const lr = await fetch(`${BASE}/api/portal/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: colabEmail, senha: SENHA }) });
  const ld = await lr.json();
  check("Login colaborador", lr.ok && !!ld.token);
  const HC = { "x-portal-auth": ld.token, "content-type": "application/json" };

  // 1. listar etapas
  const s1 = await fetch(`${BASE}/api/portal/onboarding/steps`, { headers: { "x-portal-auth": ld.token } });
  const steps = await s1.json();
  check("Listar etapas", s1.ok && steps.length >= 10, `${steps.length} etapas`);
  const temVideo = steps.some(s => s.tipo === "video" && s.url_recurso);
  const temPdf = steps.some(s => s.tipo === "pdf" && s.url_recurso);
  check("Vídeo institucional presente", temVideo);
  check("Políticas em PDF presentes", temPdf);

  // 2. marcar 2 etapas como concluídas
  const alvo = steps.slice(0, 2);
  for (const s of alvo) {
    const p = await fetch(`${BASE}/api/portal/onboarding/progress`, { method: "POST", headers: HC, body: JSON.stringify({ step_id: s.id, concluido: true }) });
    if (!p.ok) check(`Marcar etapa "${s.titulo}"`, false, `status ${p.status}`);
  }
  const g1 = await fetch(`${BASE}/api/portal/onboarding/progress`, { headers: { "x-portal-auth": ld.token } });
  const prog = await g1.json();
  check("Marcar etapas concluídas", g1.ok && prog.filter(p => p.concluido).length === 2, `${prog.filter(p => p.concluido).length} concluídas`);

  // 3. desmarcar uma
  const d1 = await fetch(`${BASE}/api/portal/onboarding/progress`, { method: "POST", headers: HC, body: JSON.stringify({ step_id: alvo[0].id, concluido: false }) });
  const g2 = await fetch(`${BASE}/api/portal/onboarding/progress`, { headers: { "x-portal-auth": ld.token } });
  const prog2 = await g2.json();
  check("Desmarcar etapa", d1.ok && prog2.filter(p => p.concluido).length === 1);

  // 4. relatório do admin
  const ar = await fetch(`${BASE}/api/admin/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: adminEmail, senha: SENHA }) });
  const cookie = (ar.headers.get("set-cookie") || "").split(";")[0];
  const r1 = await fetch(`${BASE}/api/admin/portal/onboarding/progresso`, { headers: { cookie } });
  const rd = await r1.json();
  const meu = (rd.colaboradores || []).find(c => c.user_id === colabId);
  check("Relatório de progresso do admin", r1.ok && !!meu, `pct=${meu?.pct}% concluidas=${meu?.concluidas}/${meu?.total}`);
  check("Contagem bate com o colaborador", meu?.concluidas === 1 && meu?.obrigatorias_pendentes >= 1);

  // 5. página do portal no ar
  const pg = await fetch(`${BASE}/portal/onboarding`);
  check("Página /portal/onboarding (200)", pg.ok);
} catch (e) {
  check("EXCEÇÃO", false, e.message);
} finally {
  try {
    if (colabId) {
      await sb(`portal_onboarding_progress?user_id=eq.${colabId}`, { method: "DELETE" });
      await sb(`portal_notificacoes?user_id=eq.${colabId}`, { method: "DELETE" }).catch(() => {});
      await sb(`portal_profiles?id=eq.${colabId}`, { method: "DELETE" });
    }
    if (adminId) await sb(`portal_profiles?id=eq.${adminId}`, { method: "DELETE" });
    console.log("Cleanup OK");
  } catch (e) { console.log("Cleanup parcial:", e.message); }
}
const ok = results.filter(Boolean).length;
console.log(`\n=== ${ok}/${results.length} testes passaram ===`);
process.exit(ok === results.length ? 0 : 1);
