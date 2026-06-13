// QA E2E baseline do módulo RH em produção — colaboradores, ausências, documentos, auth.
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

const SENHA = "QaRh#2026";
const adminEmail = `qa.rh.admin.${Date.now()}@costajr.com.br`;
const colabEmail = `qa.rh.colab.${Date.now()}@costajr.com.br`;
let adminId, colabId, rhId, ausenciaId, docId, admissaoId;

try {
  const [adm] = await sb("portal_profiles", { method: "POST", body: JSON.stringify({ id: randomUUID(), email: adminEmail, full_name: "QA RH Admin", role: "admin", roles: ["admin"], approval_status: "approved", senha_hash: hash(SENHA) }) });
  adminId = adm.id;
  const [col] = await sb("portal_profiles", { method: "POST", body: JSON.stringify({ id: randomUUID(), email: colabEmail, full_name: "QA RH Colab", role: "operacional", roles: ["operacional"], approval_status: "approved", senha_hash: hash(SENHA) }) });
  colabId = col.id;

  const ar = await fetch(`${BASE}/api/admin/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: adminEmail, senha: SENHA }) });
  const cookie = (ar.headers.get("set-cookie") || "").split(";")[0];
  const HA = { cookie, "content-type": "application/json" };
  check("Login admin", ar.ok && cookie.startsWith("admin_token="));

  // 1. Criar colaborador
  const c1 = await fetch(`${BASE}/api/admin/rh/colaboradores`, { method: "POST", headers: HA, body: JSON.stringify({ nome: "QA Colaborador Teste", email: colabEmail, cpf: "111.222.333-44", cargo: "Pedreiro", setor: "Obra", regime: "clt", salario: 2500, data_admissao: "2026-01-10" }) });
  const cd1 = await c1.json(); rhId = cd1.id;
  check("Criar colaborador", c1.ok && !!rhId);

  // 2. Listar + buscar
  const l1 = await fetch(`${BASE}/api/admin/rh/colaboradores?busca=QA Colaborador`, { headers: { cookie } });
  const ld1 = await l1.json();
  check("Listar/buscar colaboradores", l1.ok && ld1.some(c => c.id === rhId));

  // 3. Editar colaborador
  const e1 = await fetch(`${BASE}/api/admin/rh/colaboradores/${rhId}`, { method: "PATCH", headers: HA, body: JSON.stringify({ cargo: "Mestre de Obras" }) });
  check("Editar colaborador", e1.ok);

  // 4. Registrar ausência (férias) — dias calculados
  const a1 = await fetch(`${BASE}/api/admin/rh/ausencias`, { method: "POST", headers: HA, body: JSON.stringify({ colaborador_id: rhId, tipo: "ferias", data_inicio: "2026-07-01", data_fim: "2026-07-10", motivo: "Férias QA" }) });
  const ad1 = await a1.json(); ausenciaId = ad1.id;
  check("Registrar ausência/férias", a1.ok && !!ausenciaId, `dias=${ad1.dias}`);

  // 5. Adicionar documento com validade
  const d1 = await fetch(`${BASE}/api/admin/rh/documentos`, { method: "POST", headers: HA, body: JSON.stringify({ colaborador_id: rhId, titulo: "ASO Admissional QA", tipo: "aso", validade: "2027-01-10" }) });
  const dd1 = await d1.json(); docId = dd1.id;
  check("Adicionar documento com validade", d1.ok && !!docId);

  // 6. LGPD: endpoint de arquivo exige admin (401 sem auth)
  const sec1 = await fetch(`${BASE}/api/admin/rh/documentos/${docId}/arquivo`, { redirect: "manual" });
  check("Documento RH protegido sem auth (401)", sec1.status === 401);

  // 7. Segurança: colaborador comum NÃO acessa API de RH
  const lr = await fetch(`${BASE}/api/portal/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: colabEmail, senha: SENHA }) });
  const ld = await lr.json();
  const sec2 = await fetch(`${BASE}/api/admin/rh/colaboradores`, { headers: { "x-portal-auth": ld.token } });
  check("Colaborador não acessa RH admin (401/403)", sec2.status === 401 || sec2.status === 403, `status=${sec2.status}`);

  // 8. Admissão digital: criar link com token
  const adm1 = await fetch(`${BASE}/api/admin/rh/admissoes`, { method: "POST", headers: HA, body: JSON.stringify({ nome: "QA Candidato", email: "qa.candidato@costajr.com.br", cargo: "Servente", regime: "clt" }) });
  const admD = await adm1.json(); admissaoId = admD.id;
  check("Criar admissão digital (token)", adm1.ok && !!admD.token && admD.token.length >= 30);

  // 9. Página pública de admissão carrega com o token
  if (admD.token) {
    const pg = await fetch(`${BASE}/admissao/${admD.token}`);
    check("Página pública de admissão (200)", pg.ok);
    // token inválido não vaza
    const bad = await fetch(`${BASE}/api/admissao/token-invalido-xyz/dados`);
    check("Token de admissão inválido bloqueado", bad.status === 404 || bad.status === 400 || bad.status === 401, `status=${bad.status}`);
  }

  // 10. Validação: regime inválido rejeitado
  const v1 = await fetch(`${BASE}/api/admin/rh/colaboradores`, { method: "POST", headers: HA, body: JSON.stringify({ nome: "QA Regime Ruim", regime: "xpto" }) });
  check("Rejeita regime inválido", v1.status >= 400, `status=${v1.status}`);

  // 11. Página /admin/rh renderiza
  const pgRh = await fetch(`${BASE}/admin/rh`, { headers: { cookie } });
  check("Página /admin/rh (200)", pgRh.ok);

  // 12. dias é calculado no servidor (ignora valor falso do cliente)
  const aBogus = await fetch(`${BASE}/api/admin/rh/ausencias`, { method: "POST", headers: HA, body: JSON.stringify({ colaborador_id: rhId, tipo: "ferias", data_inicio: "2026-08-01", data_fim: "2026-08-05", dias: 999 }) });
  const aBogusD = await aBogus.json();
  check("Dias da ausência calculado no servidor (ignora cliente)", aBogus.ok && aBogusD.dias === 5, `dias=${aBogusD.dias}`);
  if (aBogusD.id) await sb(`rh_ausencias?id=eq.${aBogusD.id}`, { method: "DELETE" });

  // 13. tipo de ausência inválido → 400 limpo
  const aInv = await fetch(`${BASE}/api/admin/rh/ausencias`, { method: "POST", headers: HA, body: JSON.stringify({ colaborador_id: rhId, tipo: "xpto", data_inicio: "2026-08-01", data_fim: "2026-08-05" }) });
  check("Rejeita tipo de ausência inválido (400)", aInv.status === 400);

  // 14. Desligar grava data_desligamento
  const desl = await fetch(`${BASE}/api/admin/rh/colaboradores/${rhId}`, { method: "PATCH", headers: HA, body: JSON.stringify({ status: "desligado" }) });
  const deslD = await desl.json();
  check("Desligar grava data_desligamento", desl.ok && !!deslD.data_desligamento, `data=${deslD.data_desligamento}`);
  await fetch(`${BASE}/api/admin/rh/colaboradores/${rhId}`, { method: "PATCH", headers: HA, body: JSON.stringify({ status: "ativo", data_desligamento: "" }) });

  // 15. Documento vencido (validade no passado) aparece no filtro ?vencidos=1
  const dv = await fetch(`${BASE}/api/admin/rh/documentos`, { method: "POST", headers: HA, body: JSON.stringify({ colaborador_id: rhId, titulo: "ASO Vencido QA", tipo: "aso", validade: "2020-01-01" }) });
  const dvD = await dv.json();
  const vlist = await (await fetch(`${BASE}/api/admin/rh/documentos?vencidos=1`, { headers: { cookie } })).json();
  check("Filtro de documentos vencidos", Array.isArray(vlist) && vlist.some(x => x.id === dvD.id));
  if (dvD.id) await sb(`rh_documentos?id=eq.${dvD.id}`, { method: "DELETE" });

  // 16. Endpoint consolidado de alertas
  const al = await fetch(`${BASE}/api/admin/rh/alertas`, { headers: { cookie } });
  const alD = await al.json();
  check("API de alertas consolidados", al.ok && alD.resumo && typeof alD.resumo.vencidos === "number");

  // 17. Export de vencimentos (CSV)
  const ev = await fetch(`${BASE}/api/admin/rh/documentos/export-vencimentos`, { headers: { cookie } });
  check("Export CSV de vencimentos", ev.ok && (ev.headers.get("content-type") || "").includes("csv"));
} catch (e) {
  check("EXCEÇÃO", false, e.message);
} finally {
  try {
    if (docId) await sb(`rh_documentos?id=eq.${docId}`, { method: "DELETE" });
    if (ausenciaId) await sb(`rh_ausencias?id=eq.${ausenciaId}`, { method: "DELETE" });
    if (admissaoId) { await sb(`rh_admissoes_docs?admissao_id=eq.${admissaoId}`, { method: "DELETE" }).catch(() => {}); await sb(`rh_admissoes?id=eq.${admissaoId}`, { method: "DELETE" }); }
    if (rhId) await sb(`rh_colaboradores?id=eq.${rhId}`, { method: "DELETE" });
    if (colabId) await sb(`portal_profiles?id=eq.${colabId}`, { method: "DELETE" });
    if (adminId) await sb(`portal_profiles?id=eq.${adminId}`, { method: "DELETE" });
    console.log("Cleanup OK");
  } catch (e) { console.log("Cleanup parcial:", e.message); }
}
const ok = results.filter(Boolean).length;
console.log(`\n=== ${ok}/${results.length} testes passaram ===`);
process.exit(ok === results.length ? 0 : 1);
