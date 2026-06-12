// Confirma que perfil financeiro recebe resposta da KB (e não redirecionamento).
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
  if (!res.ok) throw new Error(`${path}: ${res.status} ${t.slice(0, 150)}`);
  return t ? JSON.parse(t) : null;
};

const SENHA = "QaJunia#2026";
const email = `qa.junia.fin.${Date.now()}@costajr.com.br`;
let uid, convId;
try {
  const [u] = await sb("portal_profiles", { method: "POST", body: JSON.stringify({ id: randomUUID(), email, full_name: "QA JunIA Fin", role: "financeiro", roles: ["financeiro"], approval_status: "approved", senha_hash: hash(SENHA) }) });
  uid = u.id;
  const lr = await fetch(`${BASE}/api/portal/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, senha: SENHA }) });
  const ld = await lr.json();
  const q = await fetch(`${BASE}/api/portal/junia`, { method: "POST", headers: { "x-portal-auth": ld.token, "content-type": "application/json" }, body: JSON.stringify({ pergunta: "Qual o prazo de pagamento do Santander?" }) });
  const d = await q.json();
  convId = d.conversa_id;
  console.log(`fonte=${d.fonte} precisa_resposta=${d.precisa_resposta}`);
  console.log(d.precisa_resposta === false && d.fonte === "base de conhecimento" ? "✅ financeiro recebe resposta da KB" : "❌ inesperado: " + JSON.stringify(d).slice(0, 300));
} finally {
  if (convId) { await sb(`portal_messages?conversation_id=eq.${convId}`, { method: "DELETE" }); await sb(`portal_conversations?id=eq.${convId}`, { method: "DELETE" }); }
  if (uid) { await sb(`portal_notificacoes?user_id=eq.${uid}`, { method: "DELETE" }).catch(()=>{}); await sb(`portal_profiles?id=eq.${uid}`, { method: "DELETE" }); }
  console.log("Cleanup OK");
}
