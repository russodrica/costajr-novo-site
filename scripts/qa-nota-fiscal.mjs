// QA E2E do cofre privado de nota fiscal dos ativos.
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

// PDF mínimo válido
const PDF_B64 = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\nxref\n0 4\n0000000000 65535 f \ntrailer<</Root 1 0 R/Size 4>>\nstartxref\n0\n%%EOF").toString("base64");

const SENHA = "QaNf#2026";
const adminEmail = `qa.nf.admin.${Date.now()}@costajr.com.br`;
let adminId, ativoId, nfPath;

try {
  const [adm] = await sb("portal_profiles", { method: "POST", body: JSON.stringify({ id: randomUUID(), email: adminEmail, full_name: "QA NF Admin", role: "admin", roles: ["admin"], approval_status: "approved", senha_hash: hash(SENHA) }) });
  adminId = adm.id;
  const [at] = await sb("ativos", { method: "POST", body: JSON.stringify({ id: randomUUID(), categoria: "informatica", descricao: "QA NF Notebook", status: "em_estoque" }) });
  ativoId = at.id;

  const ar = await fetch(`${BASE}/api/admin/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: adminEmail, senha: SENHA }) });
  const cookie = (ar.headers.get("set-cookie") || "").split(";")[0];
  const HA = { cookie, "content-type": "application/json" };
  check("Login admin", ar.ok && cookie.startsWith("admin_token="));

  // 1. Anexar NF (PDF) ao cofre
  const up = await fetch(`${BASE}/api/admin/ativos/${ativoId}/nota-fiscal`, { method: "POST", headers: HA, body: JSON.stringify({ arquivo_base64: PDF_B64, content_type: "application/pdf" }) });
  const upD = await up.json();
  nfPath = upD.nota_fiscal_path;
  check("Anexar NF (PDF) ao cofre", up.ok && !!nfPath && nfPath.endsWith(".pdf"), nfPath);

  // 2. nota_fiscal_path gravado no ativo
  const a1 = await sb(`ativos?id=eq.${ativoId}&select=nota_fiscal_path`);
  check("Caminho gravado no ativo", a1[0].nota_fiscal_path === nfPath);

  // 3. Bucket é PRIVADO — URL pública direta NÃO funciona
  const pub = await fetch(`${SB}/storage/v1/object/public/ativos-docs/${nfPath}`);
  check("Bucket privado (URL pública bloqueada)", pub.status === 400 || pub.status === 404, `status=${pub.status}`);

  // 4. Endpoint autenticado redireciona p/ URL assinada
  const arq = await fetch(`${BASE}/api/admin/ativos/${ativoId}/nota-fiscal/arquivo`, { headers: { cookie }, redirect: "manual" });
  const loc = arq.headers.get("location") || "";
  check("Endpoint serve por URL assinada (302)", (arq.status === 302 || arq.status === 307) && loc.includes("token="), `status=${arq.status}`);

  // 5. URL assinada realmente abre o PDF
  if (loc) {
    const dl = await fetch(loc);
    const ct = dl.headers.get("content-type") || "";
    check("URL assinada abre o PDF", dl.ok && ct.includes("pdf"), ct);
  } else check("URL assinada abre o PDF", false, "sem location");

  // 6. Sem login → 401 no endpoint de servir
  const sec = await fetch(`${BASE}/api/admin/ativos/${ativoId}/nota-fiscal/arquivo`, { redirect: "manual" });
  check("Bloqueia NF sem auth (401)", sec.status === 401);

  // 7. Trocar a NF substitui (não acumula)
  const up2 = await fetch(`${BASE}/api/admin/ativos/${ativoId}/nota-fiscal`, { method: "POST", headers: HA, body: JSON.stringify({ arquivo_base64: PDF_B64, content_type: "application/pdf" }) });
  const up2D = await up2.json();
  check("Trocar NF gera novo caminho", up2.ok && up2D.nota_fiscal_path !== nfPath);
  nfPath = up2D.nota_fiscal_path;

  // 8. Tipo inválido rejeitado
  const bad = await fetch(`${BASE}/api/admin/ativos/${ativoId}/nota-fiscal`, { method: "POST", headers: HA, body: JSON.stringify({ arquivo_base64: PDF_B64, content_type: "text/plain" }) });
  check("Rejeita tipo de arquivo inválido (400)", bad.status === 400);

  // 9. Remover NF do cofre
  const del = await fetch(`${BASE}/api/admin/ativos/${ativoId}/nota-fiscal`, { method: "DELETE", headers: HA });
  check("Remover NF do cofre", del.ok);
  const a2 = await sb(`ativos?id=eq.${ativoId}&select=nota_fiscal_path`);
  check("Caminho limpo após remoção", a2[0].nota_fiscal_path === null);
} catch (e) {
  check("EXCEÇÃO", false, e.message);
} finally {
  try {
    if (ativoId) {
      await sb(`ativos_movimentos?ativo_id=eq.${ativoId}`, { method: "DELETE" }).catch(() => {});
      await sb(`ativos?id=eq.${ativoId}`, { method: "DELETE" });
    }
    if (adminId) await sb(`portal_profiles?id=eq.${adminId}`, { method: "DELETE" });
    console.log("Cleanup OK");
  } catch (e) { console.log("Cleanup parcial:", e.message); }
}
const ok = results.filter(Boolean).length;
console.log(`\n=== ${ok}/${results.length} testes passaram ===`);
process.exit(ok === results.length ? 0 : 1);
