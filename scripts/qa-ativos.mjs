// QA E2E do módulo Gestão de Ativos em produção — ciclo de vida completo do ativo + termo.
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

const SENHA = "QaAtivo#2026";
const adminEmail = `qa.ativo.admin.${Date.now()}@costajr.com.br`;
const colabEmail = `qa.ativo.colab.${Date.now()}@costajr.com.br`;
let adminId, colabId, ativoId, termoId, obraId;

try {
  const [adm] = await sb("portal_profiles", { method: "POST", body: JSON.stringify({ id: randomUUID(), email: adminEmail, full_name: "QA Ativo Admin", role: "admin", roles: ["admin"], approval_status: "approved", senha_hash: hash(SENHA) }) });
  adminId = adm.id;
  const [col] = await sb("portal_profiles", { method: "POST", body: JSON.stringify({ id: randomUUID(), email: colabEmail, full_name: "QA Ativo Colab", role: "operacional", roles: ["operacional"], approval_status: "approved", senha_hash: hash(SENHA) }) });
  colabId = col.id;

  const ar = await fetch(`${BASE}/api/admin/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: adminEmail, senha: SENHA }) });
  const cookie = (ar.headers.get("set-cookie") || "").split(";")[0];
  const HA = { cookie, "content-type": "application/json" };
  check("Login admin", ar.ok && cookie.startsWith("admin_token="));

  // 1. Criar ativo (telefonia, com campos específicos)
  const c1 = await fetch(`${BASE}/api/admin/ativos`, { method: "POST", headers: HA, body: JSON.stringify({ categoria: "telefonia", descricao: "QA Smartphone Teste", marca: "Samsung", modelo: "A54", numero_serie: `QA${Date.now()}`, valor_aquisicao: 1800, garantia: true, garantia_fim: "2027-01-01", campos: { imei1: "111111111111111", linha: "11 99999-0000" } }) });
  const cd1 = await c1.json(); ativoId = cd1.id;
  check("Criar ativo", c1.ok && !!ativoId);

  // 2. Validação: categoria inválida rejeitada
  const c2 = await fetch(`${BASE}/api/admin/ativos`, { method: "POST", headers: HA, body: JSON.stringify({ categoria: "xpto", descricao: "inválido" }) });
  check("Rejeita categoria inválida", c2.status >= 400);

  // 3. Entregar a colaborador → gera termo
  const m1 = await fetch(`${BASE}/api/admin/ativos/${ativoId}/movimentar`, { method: "POST", headers: HA, body: JSON.stringify({ acao: "entregar", colaborador_id: colabId, colaborador_nome: "QA Ativo Colab", colaborador_email: colabEmail, condicao: "novo" }) });
  const md1 = await m1.json();
  termoId = md1.termo?.id;
  check("Entregar ao colaborador + termo gerado", m1.ok && !!termoId && md1.movimento?.status_novo === "alocado");

  // 4. Status do ativo virou alocado
  const a1 = await sb(`ativos?id=eq.${ativoId}&select=status,alocado_para_id`);
  check("Ativo marcado como alocado ao colaborador", a1[0].status === "alocado" && a1[0].alocado_para_id === colabId);

  // 5. Colaborador vê só o seu equipamento + termo pendente
  const lr = await fetch(`${BASE}/api/portal/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: colabEmail, senha: SENHA }) });
  const ld = await lr.json();
  const HC = { "x-portal-auth": ld.token, "content-type": "application/json" };
  const me = await fetch(`${BASE}/api/portal/meus-equipamentos`, { headers: { "x-portal-auth": ld.token } });
  const med = await me.json();
  check("Colaborador vê seu equipamento", me.ok && med.ativos.length === 1 && med.ativos[0].id === ativoId);
  check("Termo pendente aparece pro colaborador", med.termos.some(t => t.id === termoId && t.status === "pendente"));

  // 6. Aceite do termo registra IP/data
  const ac = await fetch(`${BASE}/api/portal/termos/${termoId}/aceitar`, { method: "POST", headers: HC, body: "{}" });
  const acd = await ac.json();
  check("Aceitar termo (IP/data)", ac.ok && acd.status === "aceito" && !!acd.aceito_em);

  // 7. Outro colaborador NÃO consegue aceitar o termo alheio (segurança)
  const outroEmail = `qa.ativo.outro.${Date.now()}@costajr.com.br`;
  const [outro] = await sb("portal_profiles", { method: "POST", body: JSON.stringify({ id: randomUUID(), email: outroEmail, full_name: "QA Outro", role: "operacional", roles: ["operacional"], approval_status: "approved", senha_hash: hash(SENHA) }) });
  const lo = await fetch(`${BASE}/api/portal/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: outroEmail, senha: SENHA }) });
  const lod = await lo.json();
  const t2 = await sb("ativos_termos", { method: "POST", body: JSON.stringify({ ativo_id: ativoId, colaborador_id: colabId, colaborador_nome: "QA Ativo Colab", conteudo: "x", status: "pendente" }) });
  const termo2 = t2[0].id;
  const secAc = await fetch(`${BASE}/api/portal/termos/${termo2}/aceitar`, { method: "POST", headers: { "x-portal-auth": lod.token, "content-type": "application/json" }, body: "{}" });
  check("Bloqueia aceite de termo alheio (403)", secAc.status === 403);
  await sb(`ativos_termos?id=eq.${termo2}`, { method: "DELETE" });
  await sb(`portal_profiles?id=eq.${outro.id}`, { method: "DELETE" });

  // 8. Editar dados (gera movimento de edição)
  const ed = await fetch(`${BASE}/api/admin/ativos/${ativoId}`, { method: "PATCH", headers: HA, body: JSON.stringify({ observacoes: "editado pelo QA" }) });
  check("Editar ativo", ed.ok);

  // 9. Plano preventivo: criar → executar
  const p1 = await fetch(`${BASE}/api/admin/ativos/${ativoId}/planos`, { method: "POST", headers: HA, body: JSON.stringify({ titulo: "QA Revisão", periodicidade_dias: 90 }) });
  const pd1 = await p1.json();
  const planoId = pd1.id || pd1.plano?.id;
  check("Criar plano preventivo", p1.ok && !!planoId);
  if (planoId) {
    const p2 = await fetch(`${BASE}/api/admin/ativos/${ativoId}/planos`, { method: "PATCH", headers: HA, body: JSON.stringify({ id: planoId, acao: "executar" }) });
    check("Executar plano (reprograma)", p2.ok);
  }

  // 10. Devolver → estoque + termo cancelado
  const dv = await fetch(`${BASE}/api/admin/ativos/${ativoId}/movimentar`, { method: "POST", headers: HA, body: JSON.stringify({ acao: "devolver", condicao: "bom estado" }) });
  check("Devolver ao estoque", dv.ok);
  const a2 = await sb(`ativos?id=eq.${ativoId}&select=status,alocado_para_id`);
  check("Ativo voltou ao estoque", a2[0].status === "em_estoque" && !a2[0].alocado_para_id);
  const t3 = await sb(`ativos_termos?id=eq.${termoId}&select=status`);
  check("Termo cancelado na devolução", t3[0].status === "cancelado");

  // 11. Baixa + histórico imutável preservado
  const bx = await fetch(`${BASE}/api/admin/ativos/${ativoId}/movimentar`, { method: "POST", headers: HA, body: JSON.stringify({ acao: "baixar", observacao: "fim de vida QA" }) });
  check("Baixa do ativo", bx.ok);
  const movs = await sb(`ativos_movimentos?ativo_id=eq.${ativoId}&select=tipo`);
  check("Histórico imutável preservado", movs.length >= 4, `${movs.length} movimentos`);

  // 12. Segurança: sem cookie → 401
  const sec = await fetch(`${BASE}/api/admin/ativos/${ativoId}`);
  check("Bloqueia API sem auth (401)", sec.status === 401);

  // 13. Etiqueta QR (página) exige login
  const etq = await fetch(`${BASE}/admin/ativos/${ativoId}/etiqueta`, { redirect: "manual" });
  check("Etiqueta QR protegida por login", etq.status === 302 || etq.status === 200 && false ? true : (etq.status === 302 || etq.status === 307));
} catch (e) {
  check("EXCEÇÃO", false, e.message);
} finally {
  try {
    if (ativoId) {
      // termos.movimento_id → movimentos.id: apagar termos ANTES dos movimentos
      await sb(`ativos_termos?ativo_id=eq.${ativoId}`, { method: "DELETE" });
      await sb(`ativos_movimentos?ativo_id=eq.${ativoId}`, { method: "DELETE" });
      await sb(`ativos_manutencao_planos?ativo_id=eq.${ativoId}`, { method: "DELETE" }).catch(() => {});
      await sb(`ativos_manutencoes?ativo_id=eq.${ativoId}`, { method: "DELETE" }).catch(() => {});
      await sb(`ativos_ocorrencias?ativo_id=eq.${ativoId}`, { method: "DELETE" }).catch(() => {});
      await sb(`ativos?id=eq.${ativoId}`, { method: "DELETE" });
    }
    if (colabId) { await sb(`portal_notificacoes?user_id=eq.${colabId}`, { method: "DELETE" }).catch(() => {}); await sb(`portal_profiles?id=eq.${colabId}`, { method: "DELETE" }); }
    if (adminId) await sb(`portal_profiles?id=eq.${adminId}`, { method: "DELETE" });
    console.log("Cleanup OK");
  } catch (e) { console.log("Cleanup parcial:", e.message); }
}
const ok = results.filter(Boolean).length;
console.log(`\n=== ${ok}/${results.length} testes passaram ===`);
process.exit(ok === results.length ? 0 : 1);
