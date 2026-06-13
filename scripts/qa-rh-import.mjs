// QA E2E da exportação/importação em massa de colaboradores.
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

const SENHA = "QaRhImp#2026";
const adminEmail = `qa.rhimp.${Date.now()}@costajr.com.br`;
let adminId;
const cpfUnico = `999.888.${String(Date.now()).slice(-3)}-00`;
const criados = [];

try {
  const [adm] = await sb("portal_profiles", { method: "POST", body: JSON.stringify({ id: randomUUID(), email: adminEmail, full_name: "QA RH Imp", role: "admin", roles: ["admin"], approval_status: "approved", senha_hash: hash(SENHA) }) });
  adminId = adm.id;
  const ar = await fetch(`${BASE}/api/admin/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: adminEmail, senha: SENHA }) });
  const cookie = (ar.headers.get("set-cookie") || "").split(";")[0];
  const HA = { cookie, "content-type": "application/json" };
  check("Login admin", ar.ok && cookie.startsWith("admin_token="));

  // 1. Modelo
  const mod = await fetch(`${BASE}/api/admin/rh/colaboradores/export?modelo=1`, { headers: { cookie } });
  const modTxt = await mod.text();
  check("Baixar modelo de colaboradores", mod.ok && modTxt.includes("Nome") && modTxt.includes("Regime") && modTxt.includes("# INSTRU"));

  // 2. Dry-run: 2 novos + 1 erro (regime inválido)
  const csv = [
    "ID;Nome;E-mail;Telefone;CPF;Cargo;Setor;Regime;Salário;Data admissão;Status",
    `;QA Import RH 1;qa1@costajr.com.br;11 90000-0001;${cpfUnico};Eletricista;Obra;clt;3000.00;2026-02-01;ativo`,
    `;QA Import RH 2;;;;Encanador;Obra;pj;0;;ativo`,
    `;QA Import RH Ruim;;;;Servente;Obra;regime_errado;;;ativo`,
  ].join("\n");
  const dry = await fetch(`${BASE}/api/admin/rh/colaboradores/import`, { method: "POST", headers: HA, body: JSON.stringify({ csv, confirmar: false }) });
  const dryD = await dry.json();
  check("Dry-run analisa (2 criar, 1 erro)", dry.ok && dryD.criar === 2 && dryD.erros.length === 1, `criar=${dryD.criar} erros=${dryD.erros?.length}`);

  // 3. Confirmar
  const exe = await fetch(`${BASE}/api/admin/rh/colaboradores/import`, { method: "POST", headers: HA, body: JSON.stringify({ csv, confirmar: true }) });
  const exeD = await exe.json();
  check("Confirmar cria 2", exe.ok && exeD.criados === 2);
  criados.push(...(await sb(`rh_colaboradores?nome=like.QA Import RH%25&select=id`)).map(x => x.id));

  // 4. Reimport casa por CPF (atualiza, não duplica)
  const csvUpd = ["Nome;CPF;Cargo", `QA Import RH 1 EDITADO;${cpfUnico};Mestre Eletricista`].join("\n");
  const upd = await fetch(`${BASE}/api/admin/rh/colaboradores/import`, { method: "POST", headers: HA, body: JSON.stringify({ csv: csvUpd, confirmar: false }) });
  const updD = await upd.json();
  check("Reimport casa por CPF (atualizar)", upd.ok && updD.atualizar === 1 && updD.criar === 0, `criar=${updD.criar} atualizar=${updD.atualizar}`);
  await fetch(`${BASE}/api/admin/rh/colaboradores/import`, { method: "POST", headers: HA, body: JSON.stringify({ csv: csvUpd, confirmar: true }) });
  const dep = await sb(`rh_colaboradores?cpf=eq.${encodeURIComponent(cpfUnico)}&select=nome,cargo`);
  check("Atualização sem duplicar", dep.length === 1 && dep[0].nome === "QA Import RH 1 EDITADO" && dep[0].cargo === "Mestre Eletricista", `qtd=${dep.length}`);

  // 5. Export contém o importado
  const exp = await fetch(`${BASE}/api/admin/rh/colaboradores/export`, { headers: { cookie } });
  const expTxt = await exp.text();
  check("Export CSV contém o colaborador", exp.ok && expTxt.includes("QA Import RH 1 EDITADO"));

  // 6. Cabeçalho sem Nome → 400
  const bad = await fetch(`${BASE}/api/admin/rh/colaboradores/import`, { method: "POST", headers: HA, body: JSON.stringify({ csv: "Coluna;Outra\na;b", confirmar: false }) });
  check("Rejeita cabeçalho sem Nome (400)", bad.status === 400);

  // 7. Sem auth → 401
  const sec = await fetch(`${BASE}/api/admin/rh/colaboradores/import`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ csv: "x" }) });
  check("Bloqueia import sem auth (401)", sec.status === 401);
} catch (e) {
  check("EXCEÇÃO", false, e.message);
} finally {
  try {
    const resto = await sb(`rh_colaboradores?nome=like.QA Import RH%25&select=id`);
    for (const c of resto) await sb(`rh_colaboradores?id=eq.${c.id}`, { method: "DELETE" });
    if (adminId) await sb(`portal_profiles?id=eq.${adminId}`, { method: "DELETE" });
    console.log("Cleanup OK");
  } catch (e) { console.log("Cleanup parcial:", e.message); }
}
const ok = results.filter(Boolean).length;
console.log(`\n=== ${ok}/${results.length} testes passaram ===`);
process.exit(ok === results.length ? 0 : 1);
