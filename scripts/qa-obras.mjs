// QA E2E do planejamento de obras em produção — tarefas + anotações.
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

const SENHA = "QaObra#2026";
const adminEmail = `qa.obra.admin.${Date.now()}@costajr.com.br`;
let adminId, obraId, tarefaId, anotId;

try {
  const [adm] = await sb("portal_profiles", { method: "POST", body: JSON.stringify({ id: randomUUID(), email: adminEmail, full_name: "QA Obra Admin", role: "admin", roles: ["admin"], approval_status: "approved", senha_hash: hash(SENHA) }) });
  adminId = adm.id;
  const [obra] = await sb("obras", { method: "POST", body: JSON.stringify({ id: randomUUID(), nome: `QA Obra ${Date.now()}`, status: "ativa" }) });
  obraId = obra.id;

  const ar = await fetch(`${BASE}/api/admin/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: adminEmail, senha: SENHA }) });
  const cookie = (ar.headers.get("set-cookie") || "").split(";")[0];
  const HA = { cookie, "content-type": "application/json" };
  check("Login admin", ar.ok && cookie.startsWith("admin_token="));

  // ── Tarefas ──
  const t1 = await fetch(`${BASE}/api/admin/obras/${obraId}/tarefas`, { method: "POST", headers: HA, body: JSON.stringify({ titulo: "Concretagem laje", etapa: "Estrutura", responsavel: "Equipe A", prioridade: "alta", data_inicio: "2026-06-15", data_fim: "2026-06-20" }) });
  const td1 = await t1.json(); tarefaId = td1.id;
  check("Criar tarefa", t1.ok && !!tarefaId);

  const t2 = await fetch(`${BASE}/api/admin/obras/${obraId}/tarefas?tarefa=${tarefaId}`, { method: "PATCH", headers: HA, body: JSON.stringify({ status: "em_andamento" }) });
  check("Atualizar status da tarefa", t2.ok && (await t2.json()).status === "em_andamento");

  const t3 = await fetch(`${BASE}/api/admin/obras/${obraId}/tarefas`, { headers: HA });
  const lista = await t3.json();
  check("Listar tarefas", t3.ok && lista.length === 1 && lista[0].etapa === "Estrutura");

  // status inválido rejeitado
  const t4 = await fetch(`${BASE}/api/admin/obras/${obraId}/tarefas?tarefa=${tarefaId}`, { method: "PATCH", headers: HA, body: JSON.stringify({ status: "xpto" }) });
  check("Rejeita status inválido (400)", t4.status === 400);

  // ── Anotações ──
  const a1 = await fetch(`${BASE}/api/admin/obras/${obraId}/anotacoes`, { method: "POST", headers: HA, body: JSON.stringify({ texto: "Cliente pediu adiantar a entrega." }) });
  const ad1 = await a1.json(); anotId = ad1.id;
  check("Criar anotação", a1.ok && !!anotId && ad1.criado_por?.includes("qa.obra"));

  const a2 = await fetch(`${BASE}/api/admin/obras/${obraId}/anotacoes`, { headers: HA });
  check("Listar anotações", a2.ok && (await a2.json()).length === 1);

  // ── Exclusões ──
  const a3 = await fetch(`${BASE}/api/admin/obras/${obraId}/anotacoes?anotacao=${anotId}`, { method: "DELETE", headers: HA });
  check("Excluir anotação", a3.ok); if (a3.ok) anotId = null;
  const t5 = await fetch(`${BASE}/api/admin/obras/${obraId}/tarefas?tarefa=${tarefaId}`, { method: "DELETE", headers: HA });
  check("Excluir tarefa", t5.ok); if (t5.ok) tarefaId = null;

  // ── Segurança: sem cookie → 401 ──
  const sec = await fetch(`${BASE}/api/admin/obras/${obraId}/tarefas`);
  check("Bloqueia sem auth (401)", sec.status === 401);

  // ── Página da obra renderiza ──
  const pg = await fetch(`${BASE}/admin/obras/${obraId}`, { headers: { cookie } });
  check("Página da obra (200)", pg.ok);
} catch (e) {
  check("EXCEÇÃO", false, e.message);
} finally {
  try {
    if (tarefaId) await sb(`obras_tarefas?id=eq.${tarefaId}`, { method: "DELETE" });
    if (anotId) await sb(`obras_anotacoes?id=eq.${anotId}`, { method: "DELETE" });
    if (obraId) {
      await sb(`obras_tarefas?obra_id=eq.${obraId}`, { method: "DELETE" });
      await sb(`obras_anotacoes?obra_id=eq.${obraId}`, { method: "DELETE" });
      await sb(`obras?id=eq.${obraId}`, { method: "DELETE" });
    }
    if (adminId) await sb(`portal_profiles?id=eq.${adminId}`, { method: "DELETE" });
    console.log("Cleanup OK");
  } catch (e) { console.log("Cleanup parcial:", e.message); }
}
const ok = results.filter(Boolean).length;
console.log(`\n=== ${ok}/${results.length} testes passaram ===`);
process.exit(ok === results.length ? 0 : 1);
