// QA E2E da Gestão de Conteúdo em produção — CRUD das 4 áreas + upload + KB import + notificação.
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

const SENHA = "QaCont#2026";
const adminEmail = `qa.cont.admin.${Date.now()}@costajr.com.br`;
const colabEmail = `qa.cont.colab.${Date.now()}@costajr.com.br`;
let adminId, colabId, comunicadoId, kbId, onbId, pdfId, uploadPath;
const criadosKb = [];

try {
  const [adm] = await sb("portal_profiles", { method: "POST", body: JSON.stringify({ id: randomUUID(), email: adminEmail, full_name: "QA Conteudo Admin", role: "admin", roles: ["admin"], approval_status: "approved", senha_hash: hash(SENHA) }) });
  adminId = adm.id;
  const [col] = await sb("portal_profiles", { method: "POST", body: JSON.stringify({ id: randomUUID(), email: colabEmail, full_name: "QA Conteudo Colab", role: "operacional", roles: ["operacional"], approval_status: "approved", senha_hash: hash(SENHA) }) });
  colabId = col.id;

  const ar = await fetch(`${BASE}/api/admin/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: adminEmail, senha: SENHA }) });
  const cookie = (ar.headers.get("set-cookie") || "").split(";")[0];
  const HA = { cookie, "content-type": "application/json" };
  check("Login admin", ar.ok && cookie.startsWith("admin_token="));

  // ── 1. Comunicado: criar → notificação pro colaborador ──
  const c1 = await fetch(`${BASE}/api/admin/portal/comunicados`, { method: "POST", headers: HA, body: JSON.stringify({ title: "QA Comunicado Teste", content: "Conteúdo de teste do QA — pode ignorar.", category: "comunicado", target_role: "all" }) });
  const cd1 = await c1.json();
  comunicadoId = cd1.id;
  check("Criar comunicado", c1.ok && !!comunicadoId);

  const notifs = await sb(`portal_notificacoes?user_id=eq.${colabId}&tipo=eq.comunicado&select=id,titulo`);
  check("Comunicado notificou colaborador", notifs.length >= 1, notifs[0]?.titulo);

  const cdel = await fetch(`${BASE}/api/admin/portal/comunicados/${comunicadoId}`, { method: "DELETE", headers: HA });
  check("Excluir comunicado", cdel.ok); if (cdel.ok) comunicadoId = null;

  // ── 2. KB: criar → editar → excluir ──
  const k1 = await fetch(`${BASE}/api/admin/portal/kb`, { method: "POST", headers: HA, body: JSON.stringify({ question: "QA pergunta teste?", answer: "QA resposta teste.", category: "Geral", access_roles: ["all"] }) });
  const kd1 = await k1.json(); kbId = kd1.id;
  check("Criar item KB", k1.ok && !!kbId);
  const k2 = await fetch(`${BASE}/api/admin/portal/kb/${kbId}`, { method: "PUT", headers: HA, body: JSON.stringify({ question: "QA pergunta editada?", answer: "QA resposta editada.", category: "Geral", access_roles: ["all"] }) });
  check("Editar item KB", k2.ok);
  const k3 = await fetch(`${BASE}/api/admin/portal/kb/${kbId}`, { method: "DELETE", headers: HA });
  check("Excluir item KB", k3.ok); if (k3.ok) kbId = null;

  // ── 3. KB importar por URL (página HTML do próprio site) ──
  const i1 = await fetch(`${BASE}/api/admin/portal/kb/importar`, { method: "POST", headers: HA, body: JSON.stringify({ titulo: `QA Importado ${Date.now()}`, categoria: "Geral", url: "https://www.costajr.com.br/sobre" }) });
  const id1 = await i1.json();
  check("Importar KB por URL", i1.ok && id1.blocos >= 1, `${id1.blocos} blocos`);
  if (i1.ok) {
    const imp = await sb(`portal_kb?question=like.QA%20Importado%25&select=id`);
    criadosKb.push(...imp.map(x => x.id));
  }

  // ── 4. KB importar por PDF (base64 mínimo gerado com pdf-lib local) ──
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Politica de teste QA: O colaborador deve usar capacete e botas em obra. " +
    "Este documento e um teste automatizado da importacao de PDF para a base de conhecimento da JunIA.", { x: 40, y: 780, size: 12, font, maxWidth: 510, lineHeight: 16 });
  const pdfB64 = Buffer.from(await doc.save()).toString("base64");
  const i2 = await fetch(`${BASE}/api/admin/portal/kb/importar`, { method: "POST", headers: HA, body: JSON.stringify({ titulo: `QA PDF ${Date.now()}`, categoria: "Geral", arquivo_base64: pdfB64 }) });
  const id2 = await i2.json();
  check("Importar KB por PDF", i2.ok && id2.blocos >= 1, `${id2.blocos} blocos / ${id2.caracteres} chars`);
  if (i2.ok) {
    const imp2 = await sb(`portal_kb?question=like.QA%20PDF%25&select=id`);
    criadosKb.push(...imp2.map(x => x.id));
  }

  // ── 5. Upload assinado: pedir URL → PUT → arquivo acessível ──
  const u1 = await fetch(`${BASE}/api/admin/portal/upload-url`, { method: "POST", headers: HA, body: JSON.stringify({ nome: "qa-teste.pdf", content_type: "application/pdf" }) });
  const ud1 = await u1.json();
  check("Gerar URL de upload", u1.ok && !!ud1.signed_url, ud1.path);
  uploadPath = ud1.path;
  const u2 = await fetch(ud1.signed_url, { method: "PUT", headers: { "content-type": "application/pdf" }, body: Buffer.from(pdfB64, "base64") });
  check("Upload via URL assinada", u2.ok, `status ${u2.status}`);
  const u3 = await fetch(ud1.public_url);
  check("Arquivo público acessível", u3.ok && (u3.headers.get("content-type") || "").includes("pdf"));

  // ── 6. Onboarding: criar → excluir ──
  const o1 = await fetch(`${BASE}/api/admin/portal/onboarding`, { method: "POST", headers: HA, body: JSON.stringify({ titulo: "QA Etapa", conteudo: "Etapa de teste", tipo: "texto", ordem: 99, obrigatorio: false, url_recurso: null, access_roles: ["all"] }) });
  const od1 = await o1.json(); onbId = od1.id;
  check("Criar etapa onboarding", o1.ok && !!onbId);
  const o2 = await fetch(`${BASE}/api/admin/portal/onboarding/${onbId}`, { method: "DELETE", headers: HA });
  check("Excluir etapa onboarding", o2.ok); if (o2.ok) onbId = null;

  // ── 7. Treinamentos PDF: criar → excluir ──
  const t1 = await fetch(`${BASE}/api/admin/portal/treinamentos/pdfs`, { method: "POST", headers: HA, body: JSON.stringify({ titulo: "QA Material", url: ud1.public_url, categoria: "QA", descricao: "teste", ordem: 99, paginas: 1, publicado: false, access_roles: ["all"] }) });
  const td1 = await t1.json(); pdfId = td1.id;
  check("Criar material treinamento", t1.ok && !!pdfId);
  if (pdfId) {
    const t2 = await fetch(`${BASE}/api/admin/portal/treinamentos/pdfs/${pdfId}`, { method: "DELETE", headers: HA });
    check("Excluir material treinamento", t2.ok); if (t2.ok) pdfId = null;
  }
} catch (e) {
  check("EXCEÇÃO", false, e.message);
} finally {
  try {
    for (const id of criadosKb) await sb(`portal_kb?id=eq.${id}`, { method: "DELETE" });
    if (kbId) await sb(`portal_kb?id=eq.${kbId}`, { method: "DELETE" });
    if (comunicadoId) await sb(`portal_announcements?id=eq.${comunicadoId}`, { method: "DELETE" });
    if (onbId) await sb(`portal_onboarding_steps?id=eq.${onbId}`, { method: "DELETE" });
    if (uploadPath) await fetch(`${SB}/storage/v1/object/portal/${uploadPath}`, { method: "DELETE", headers: { apikey: KEY, authorization: `Bearer ${KEY}` } });
    if (colabId) { await sb(`portal_notificacoes?user_id=eq.${colabId}`, { method: "DELETE" }); await sb(`portal_profiles?id=eq.${colabId}`, { method: "DELETE" }); }
    if (adminId) await sb(`portal_profiles?id=eq.${adminId}`, { method: "DELETE" });
    console.log("Cleanup OK");
  } catch (e) { console.log("Cleanup parcial:", e.message); }
}
const ok = results.filter(Boolean).length;
console.log(`\n=== ${ok}/${results.length} testes passaram ===`);
process.exit(ok === results.length ? 0 : 1);
