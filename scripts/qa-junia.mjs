// QA E2E da JunIA em produção — cria usuários temporários, testa o fluxo completo e limpa tudo.
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
  const res = await fetch(`${SB}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json", prefer: "return=representation", ...(opts.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
};

const results = [];
const check = (nome, ok, detalhe = "") => { results.push({ nome, ok, detalhe }); console.log(`${ok ? "✅" : "❌"} ${nome}${detalhe ? " — " + detalhe : ""}`); };

const SENHA = "QaJunia#2026";
const colabEmail = `qa.junia.colab.${Date.now()}@costajr.com.br`;
const adminEmail = `qa.junia.admin.${Date.now()}@costajr.com.br`;
let colabId, adminId, convId, pendId, kbIds = [], notifIds = [];

try {
  // ── Setup: usuários temporários ──
  const [colab] = await sb("portal_profiles", { method: "POST", body: JSON.stringify({ id: randomUUID(), email: colabEmail, full_name: "QA JunIA Colab", role: "operacional", roles: ["operacional"], approval_status: "approved", senha_hash: hash(SENHA) }) });
  colabId = colab.id;
  const [adm] = await sb("portal_profiles", { method: "POST", body: JSON.stringify({ id: randomUUID(), email: adminEmail, full_name: "QA JunIA Admin", role: "admin", roles: ["admin"], approval_status: "approved", senha_hash: hash(SENHA) }) });
  adminId = adm.id;
  console.log("Setup OK:", colabId, adminId);

  // ── Login colaborador ──
  const lr = await fetch(`${BASE}/api/portal/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: colabEmail, senha: SENHA }) });
  const ld = await lr.json();
  check("Login colaborador", lr.ok && !!ld.token, `status ${lr.status}`);
  const HC = { "x-portal-auth": ld.token, "content-type": "application/json" };

  // ── Login admin (cookie) ──
  const ar = await fetch(`${BASE}/api/admin/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: adminEmail, senha: SENHA }) });
  const cookie = (ar.headers.get("set-cookie") || "").split(";")[0];
  check("Login admin", ar.ok && cookie.startsWith("admin_token="), `status ${ar.status}`);
  const HA = { cookie, "content-type": "application/json" };

  // ── 1. Pergunta que existe na KB ──
  const q1 = await fetch(`${BASE}/api/portal/junia`, { method: "POST", headers: HC, body: JSON.stringify({ pergunta: "Qual o prazo de pagamento do Santander?" }) });
  const d1 = await q1.json();
  convId = d1.conversa_id;
  check("Pergunta com resposta na KB", q1.ok && d1.precisa_resposta === false && d1.fonte === "base de conhecimento", `fonte=${d1.fonte}`);

  // ── 2. Pergunta desconhecida → pendência ──
  const perguntaRara = `Qual a política de uso do drone vermelho QA ${Date.now()}?`;
  const q2 = await fetch(`${BASE}/api/portal/junia`, { method: "POST", headers: HC, body: JSON.stringify({ conversa_id: convId, pergunta: perguntaRara }) });
  const d2 = await q2.json();
  check("Pergunta desconhecida vira pendência", q2.ok && d2.precisa_resposta === true, `precisa_resposta=${d2.precisa_resposta}`);

  const pend = await sb(`portal_pending_questions?question=eq.${encodeURIComponent(perguntaRara)}&select=id,status,conversation_id`);
  pendId = pend[0]?.id;
  check("Pendência criada no banco", !!pendId && pend[0].status === "pending" && pend[0].conversation_id === convId, `id=${pendId}`);

  // ── 3. GET conversas e mensagens ──
  const gc = await fetch(`${BASE}/api/portal/junia`, { headers: { "x-portal-auth": ld.token } });
  const convs = await gc.json();
  check("Listar conversas", gc.ok && Array.isArray(convs) && convs.some(c => c.id === convId));
  const gm = await fetch(`${BASE}/api/portal/junia?conversa=${convId}`, { headers: { "x-portal-auth": ld.token } });
  const msgs = await gm.json();
  check("Listar mensagens", gm.ok && msgs.length >= 4, `${msgs.length} mensagens`);

  // ── 4. Admin responde + adiciona à KB ──
  const RESP = "O drone vermelho QA só pode ser usado com autorização da coordenação. (resposta de teste)";
  const rr = await fetch(`${BASE}/api/admin/perguntas`, { method: "POST", headers: HA, body: JSON.stringify({ id: pendId, resposta: RESP, adicionar_kb: true, categoria: "Operacional" }) });
  const rd = await rr.json();
  check("Admin responde pendência", rr.ok && rd.ok, `status ${rr.status} ${JSON.stringify(rd).slice(0, 120)}`);

  const kb = await sb(`portal_kb?question=eq.${encodeURIComponent(perguntaRara)}&select=id`);
  kbIds = kb.map(k => k.id);
  check("Resposta entrou na KB", kbIds.length === 1);

  // ── 5. Resposta aparece no chat + notificação ──
  const gm2 = await fetch(`${BASE}/api/portal/junia?conversa=${convId}`, { headers: { "x-portal-auth": ld.token } });
  const msgs2 = await gm2.json();
  check("Resposta do gestor no chat", msgs2.some(m => m.content && m.content.includes(RESP)));

  const gn = await fetch(`${BASE}/api/portal/notificacoes`, { headers: { "x-portal-auth": ld.token } });
  const nd = await gn.json();
  notifIds = (nd.notificacoes || []).map(n => n.id);
  check("Notificação criada", gn.ok && nd.nao_lidas >= 1 && nd.notificacoes.some(n => n.tipo === "resposta_disponivel"), `nao_lidas=${nd.nao_lidas}`);

  // ── 6. Marcar todas como lidas ──
  const pn = await fetch(`${BASE}/api/portal/notificacoes`, { method: "PATCH", headers: HC, body: JSON.stringify({ todas: true }) });
  const gn2 = await fetch(`${BASE}/api/portal/notificacoes`, { headers: { "x-portal-auth": ld.token } });
  const nd2 = await gn2.json();
  check("Marcar todas como lidas", pn.ok && nd2.nao_lidas === 0, `nao_lidas=${nd2.nao_lidas}`);

  // ── 7. JunIA agora responde sozinha (KB aprendida) ──
  const q3 = await fetch(`${BASE}/api/portal/junia`, { method: "POST", headers: HC, body: JSON.stringify({ conversa_id: convId, pergunta: perguntaRara }) });
  const d3 = await q3.json();
  check("JunIA aprendeu (responde da KB)", q3.ok && d3.precisa_resposta === false && d3.resposta.includes("drone vermelho"), `fonte=${d3.fonte}`);

  // ── 8. Sem acesso: revogar área forum do operacional? (não mexer na matriz real — pular) ──
} catch (e) {
  check("EXCEÇÃO", false, e.message);
} finally {
  // ── Cleanup ──
  try {
    if (convId) {
      await sb(`portal_messages?conversation_id=eq.${convId}`, { method: "DELETE" });
      await sb(`portal_conversations?id=eq.${convId}`, { method: "DELETE" });
    }
    if (pendId) await sb(`portal_pending_questions?id=eq.${pendId}`, { method: "DELETE" });
    for (const id of kbIds) await sb(`portal_kb?id=eq.${id}`, { method: "DELETE" });
    if (colabId) {
      await sb(`portal_notificacoes?user_id=eq.${colabId}`, { method: "DELETE" });
      await sb(`portal_sessoes?user_id=eq.${colabId}`, { method: "DELETE" }).catch(() => {});
      await sb(`portal_profiles?id=eq.${colabId}`, { method: "DELETE" });
    }
    if (adminId) {
      await sb(`portal_sessoes?user_id=eq.${adminId}`, { method: "DELETE" }).catch(() => {});
      await sb(`portal_profiles?id=eq.${adminId}`, { method: "DELETE" });
    }
    console.log("Cleanup OK");
  } catch (e) { console.log("Cleanup parcial:", e.message); }
}

const falhas = results.filter(r => !r.ok);
console.log(`\n=== ${results.length - falhas.length}/${results.length} testes passaram ===`);
process.exit(falhas.length ? 1 : 0);
