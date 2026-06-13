// QA E2E da exportação/importação em massa de ativos em produção.
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

const SENHA = "QaImp#2026";
const adminEmail = `qa.imp.admin.${Date.now()}@costajr.com.br`;
let adminId;
const patrimUnico = `QAPAT-${Date.now()}`;
const criados = [];

try {
  const [adm] = await sb("portal_profiles", { method: "POST", body: JSON.stringify({ id: randomUUID(), email: adminEmail, full_name: "QA Imp Admin", role: "admin", roles: ["admin"], approval_status: "approved", senha_hash: hash(SENHA) }) });
  adminId = adm.id;
  const ar = await fetch(`${BASE}/api/admin/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: adminEmail, senha: SENHA }) });
  const cookie = (ar.headers.get("set-cookie") || "").split(";")[0];
  const HA = { cookie, "content-type": "application/json" };
  check("Login admin", ar.ok && cookie.startsWith("admin_token="));

  // 1. Baixar modelo
  const mod = await fetch(`${BASE}/api/admin/ativos/export?modelo=1`, { headers: { cookie } });
  const modTxt = await mod.text();
  check("Baixar modelo de importação", mod.ok && modTxt.includes("Categoria") && modTxt.includes("Campos específicos") && modTxt.includes("# INSTRU"));

  // 2. Importar (dry-run) — 2 novos + 1 erro (categoria inválida)
  const csv = [
    "ID;Categoria;Descrição;Subcategoria;Código interno;Nº patrimonial;Nº de série;Marca;Modelo;Fabricante;Valor aquisição;Data aquisição;Fornecedor;Nº nota fiscal;Garantia até;Campos específicos;Observações;Status;Com quem / onde",
    `;telefonia;QA Import Tel;Celular;TI-QA1;${patrimUnico};SNQA1;Samsung;A54;Samsung;1800.00;2026-01-10;Loja;NF1;2027-01-10;imei1=350000000000099; linha=11 98888-0000;importado;Em estoque;`,
    `;veiculo;QA Import Veic;;;;;Fiat;Strada;Fiat;90000;2025-06-01;Concessionária;NF2;;placa=QAB1C23; ano=2025;frota;;`,
    `;categoria_errada;QA Linha Ruim;;;;;;;;;;;;;;;;`,
  ].join("\n");
  const dry = await fetch(`${BASE}/api/admin/ativos/import`, { method: "POST", headers: HA, body: JSON.stringify({ csv, confirmar: false }) });
  const dryD = await dry.json();
  check("Dry-run analisa corretamente", dry.ok && dryD.dry_run && dryD.criar === 2 && dryD.erros.length === 1, `criar=${dryD.criar} atualizar=${dryD.atualizar} erros=${dryD.erros?.length}`);
  check("Erro aponta a linha certa", dryD.erros?.[0]?.linha === 4, `linha=${dryD.erros?.[0]?.linha}`);

  // 3. Confirmar importação
  const exe = await fetch(`${BASE}/api/admin/ativos/import`, { method: "POST", headers: HA, body: JSON.stringify({ csv, confirmar: true }) });
  const exeD = await exe.json();
  check("Confirmar importação cria 2", exe.ok && exeD.criados === 2);
  const novos = await sb(`ativos?or=(numero_patrimonial.eq.${patrimUnico},numero_serie.eq.SNQA1)&select=id,descricao,campos,categoria`);
  const tel = (await sb(`ativos?numero_patrimonial=eq.${patrimUnico}&select=id,campos`))[0];
  criados.push(...(await sb(`ativos?descricao=like.QA Import%25&select=id`)).map(x => x.id));
  check("Campos específicos importados (IMEI)", tel?.campos?.imei1 === "350000000000099", `imei=${tel?.campos?.imei1}`);

  // 4. Reimportar atualizando (mesmo patrimônio, sem ID) → atualiza, não duplica
  const csvUpd = [
    "Categoria;Descrição;Nº patrimonial;Observações",
    `telefonia;QA Import Tel EDITADO;${patrimUnico};atualizado via reimport`,
  ].join("\n");
  const upd = await fetch(`${BASE}/api/admin/ativos/import`, { method: "POST", headers: HA, body: JSON.stringify({ csv: csvUpd, confirmar: false }) });
  const updD = await upd.json();
  check("Reimport casa por patrimônio (atualizar, não criar)", upd.ok && updD.atualizar === 1 && updD.criar === 0, `criar=${updD.criar} atualizar=${updD.atualizar}`);
  const updExe = await fetch(`${BASE}/api/admin/ativos/import`, { method: "POST", headers: HA, body: JSON.stringify({ csv: csvUpd, confirmar: true }) });
  check("Atualização aplicada", updExe.ok && (await updExe.json()).atualizados === 1);
  const telDepois = await sb(`ativos?numero_patrimonial=eq.${patrimUnico}&select=descricao`);
  check("Não duplicou (1 só com o patrimônio)", telDepois.length === 1 && telDepois[0].descricao === "QA Import Tel EDITADO", `qtd=${telDepois.length}`);

  // 5. Round-trip: exporta e confere que a linha importada aparece no CSV
  const exp = await fetch(`${BASE}/api/admin/ativos/export?busca=QA Import`, { headers: { cookie } });
  const expTxt = await exp.text();
  check("Round-trip: ativo aparece no export", exp.ok && expTxt.includes(patrimUnico) && expTxt.includes("imei1="));

  // 6. Cabeçalho inválido rejeitado
  const bad = await fetch(`${BASE}/api/admin/ativos/import`, { method: "POST", headers: HA, body: JSON.stringify({ csv: "Coluna1;Coluna2\na;b", confirmar: false }) });
  check("Rejeita cabeçalho sem Categoria/Descrição (400)", bad.status === 400);

  // 7. Segurança: sem cookie → 401
  const sec = await fetch(`${BASE}/api/admin/ativos/import`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ csv: "x" }) });
  check("Bloqueia import sem auth (401)", sec.status === 401);
} catch (e) {
  check("EXCEÇÃO", false, e.message);
} finally {
  try {
    const ids = [...new Set(criados)];
    for (const id of ids) { await sb(`ativos_movimentos?ativo_id=eq.${id}`, { method: "DELETE" }); }
    for (const id of ids) { await sb(`ativos?id=eq.${id}`, { method: "DELETE" }); }
    // garante limpeza por descrição
    const resto = await sb(`ativos?descricao=like.QA Import%25&select=id`);
    for (const a of resto) { await sb(`ativos_movimentos?ativo_id=eq.${a.id}`, { method: "DELETE" }); await sb(`ativos?id=eq.${a.id}`, { method: "DELETE" }); }
    if (adminId) await sb(`portal_profiles?id=eq.${adminId}`, { method: "DELETE" });
    console.log("Cleanup OK");
  } catch (e) { console.log("Cleanup parcial:", e.message); }
}
const ok = results.filter(Boolean).length;
console.log(`\n=== ${ok}/${results.length} testes passaram ===`);
process.exit(ok === results.length ? 0 : 1);
