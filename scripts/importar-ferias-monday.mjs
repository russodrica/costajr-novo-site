// Importa as FÉRIAS PROGRAMADAS do board RH do Monday (6629107099) para o módulo
// de Férias (rh_ferias_periodos + rh_ferias_parcelas). Casa por monday_id.
// Colunas do Monday: dup__of_f_rias__1 (Férias, range) + cronograma__1 (Cronograma,
// range) = parcelas; dup__of_venc_f_rias__1 (Venc. Férias, data) = limite concessivo.
// Idempotente: não duplica parcela com a mesma data_inicio no mesmo período.
// Uso: node scripts/importar-ferias-monday.mjs
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(readFileSync(resolve(root, ".env"), "utf8").split(/\r?\n/)
  .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
  .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]));
const URL = env.PUBLIC_SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" };
const ATOR = "import-ferias-monday";

// ── Dados extraídos do board RH (fresco, 14/06/2026) ──
// mid = monday item id; f = Férias (range); c = Cronograma (range); v = Venc. Férias (data)
const MONDAY = [
  { mid: "6629107314", f: "2026-06-29 - 2026-07-17", c: "2026-01-05 - 2026-01-11", v: null },
  { mid: "6713456500", f: "2026-05-12 - 2026-05-26", c: "2027-01-04 - 2027-01-18", v: "2025-08-04" },
  { mid: "6713456458", f: "2026-08-17 - 2026-08-31", c: "2027-01-26 - 2027-02-09", v: "2025-11-01" },
  { mid: "7254785941", f: null, c: "2025-09-09 - 2025-09-23", v: "2026-07-20" },
  { mid: "7335010451", f: null, c: null, v: "2026-08-05" },
  { mid: "6713456235", f: "2026-05-04 - 2026-05-11", c: "2026-03-09 - 2026-03-23", v: null },
  { mid: "6713456284", f: "2026-07-20 - 2026-08-03", c: "2026-02-23 - 2026-03-09", v: null },
  { mid: "6713456546", f: "2026-04-02 - 2026-04-11", c: "2026-02-09 - 2026-02-13", v: null },
  { mid: "7054882589", f: "2025-09-08 - 2025-09-22", c: "2025-02-13 - 2025-02-27", v: null },
  { mid: "6713456212", f: "2024-12-16 - 2024-12-27", c: "2024-07-15 - 2024-07-19", v: null },
  { mid: "6713456264", f: "2024-04-18 - 2024-05-02", c: "2023-09-18 - 2023-09-22", v: null },
  { mid: "7510893729", f: "2026-01-05 - 2026-01-19", c: "2025-12-01 - 2025-12-15", v: null },
  { mid: "18033954949", f: "2027-02-08 - 2027-02-22", c: "2026-11-09 - 2026-11-23", v: null },
  { mid: "10763268435", f: "2027-07-21 - 2027-08-04", c: "2027-02-15 - 2027-03-01", v: null },
  { mid: "6713456410", f: null, c: "2024-05-13 - 2024-06-12", v: null },
  { mid: "7054819191", f: null, c: null, v: "2026-06-29" },
  { mid: "7602790817", f: null, c: "2026-01-27 - 2026-02-10", v: null },
  { mid: "7306560039", f: null, c: "2025-09-24 - 2025-10-08", v: "2026-07-28" },
  { mid: "6713456306", f: "2025-05-05 - 2025-05-19", c: "2025-03-17 - 2025-03-31", v: "2025-05-21" },
  { mid: "6713456332", f: null, c: "2024-12-09 - 2025-01-07", v: "2024-12-17" },
  { mid: "7334990046", f: null, c: "2025-11-12 - 2025-11-26", v: "2026-08-03" },
  { mid: "7254783984", f: null, c: "2025-08-25 - 2025-09-08", v: "2026-07-20" },
  { mid: "7054167875", f: null, c: "2025-07-21 - 2025-08-04", v: "2026-06-18" },
  { mid: "7409533247", f: null, c: "2026-01-06 - 2026-01-20", v: "2026-08-12" },
  { mid: "7306563447", f: null, c: "2025-10-28 - 2025-11-11", v: "2026-07-28" },
  { mid: "7306562042", f: null, c: "2025-10-13 - 2025-10-27", v: "2026-07-28" },
  { mid: "6713456374", f: null, c: "2025-08-18 - 2025-09-01", v: "2025-08-12" },
];

// ── helpers de data ──
const hoje = new Date().toISOString().slice(0, 10);
const addMonths = (iso, n) => { const [y, m, d] = iso.split("-").map(Number); const b = new Date(Date.UTC(y, m - 1 + n, 1)); const last = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth() + 1, 0)).getUTCDate(); b.setUTCDate(Math.min(d, last)); return b.toISOString().slice(0, 10); };
const addDays = (iso, n) => new Date(new Date(iso + "T00:00:00Z").getTime() + n * 86400000).toISOString().slice(0, 10);
const diffDias = (a, b) => Math.round((new Date(a + "T00:00:00Z") - new Date(b + "T00:00:00Z")) / 86400000);
function parseRange(s) {
  if (!s) return null;
  const m = String(s).match(/(\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})/);
  if (!m) return null;
  const ini = m[1], fim = m[2];
  const dias = diffDias(fim, ini) + 1;
  if (dias < 1 || dias > 60) return null;
  return { data_inicio: ini, data_fim: fim, dias };
}

async function log(acao, entidade, registro_id, descricao, dados) {
  await fetch(`${URL}/rest/v1/audit_log`, { method: "POST", headers: H, body: JSON.stringify({ usuario_email: ATOR, usuario_role: "admin", acao, entidade, registro_id: registro_id ? String(registro_id) : null, descricao, dados: dados ?? null }) }).catch(() => {});
}

const colabPorMid = {};
{
  const r = await fetch(`${URL}/rest/v1/rh_colaboradores?select=id,nome,monday_id,data_admissao,regime,status&monday_id=not.is.null&limit=3000`, { headers: H });
  for (const c of await r.json()) colabPorMid[String(c.monday_id)] = c;
}

let periodos = 0, parcelas = 0, semColab = 0, semDados = 0;
for (const it of MONDAY) {
  const c = colabPorMid[it.mid];
  if (!c) { semColab++; console.log("  ! sem colaborador p/ monday_id", it.mid); continue; }
  const ranges = [parseRange(it.f), parseRange(it.c)].filter(Boolean);
  if (!ranges.length && !it.v) { semDados++; continue; }

  // período: usa o mais recente existente; senão cria (limite concessivo = venc, se houver)
  let periodo;
  {
    const r = await fetch(`${URL}/rest/v1/rh_ferias_periodos?select=*&colaborador_id=eq.${c.id}&order=inicio_aquisitivo.desc&limit=1`, { headers: H });
    periodo = (await r.json())[0];
  }
  if (!periodo) {
    let inicio_aquisitivo, fim_aquisitivo, limite_concessivo;
    if (it.v) { limite_concessivo = it.v; fim_aquisitivo = addMonths(it.v, -12); inicio_aquisitivo = addDays(addMonths(fim_aquisitivo, -12), 1); }
    else if (c.data_admissao) { let ciclo = 0; while (diffDias(addMonths(c.data_admissao, (ciclo + 1) * 12), hoje) <= 0) ciclo++; ciclo = Math.max(0, ciclo - 1); inicio_aquisitivo = addMonths(c.data_admissao, ciclo * 12); fim_aquisitivo = addDays(addMonths(inicio_aquisitivo, 12), -1); limite_concessivo = addMonths(fim_aquisitivo, 12); }
    else { const base = ranges[0]?.data_inicio || it.v || hoje; inicio_aquisitivo = addMonths(base, -12); fim_aquisitivo = addDays(base, -1); limite_concessivo = addMonths(base, 12); }
    const r = await fetch(`${URL}/rest/v1/rh_ferias_periodos`, { method: "POST", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify({ colaborador_id: c.id, inicio_aquisitivo, fim_aquisitivo, limite_concessivo, dias_direito: 30, status: "aberto" }) });
    periodo = (await r.json())[0];
    periodos++;
    await log("criar", "rh_ferias_periodos", periodo.id, `Período de férias importado do Monday para ${c.nome}`, { monday_id: it.mid });
  } else if (it.v && periodo.limite_concessivo !== it.v) {
    await fetch(`${URL}/rest/v1/rh_ferias_periodos?id=eq.${periodo.id}`, { method: "PATCH", headers: H, body: JSON.stringify({ limite_concessivo: it.v }) });
    periodo.limite_concessivo = it.v;
  }

  // parcelas existentes (p/ idempotência)
  const ex = await (await fetch(`${URL}/rest/v1/rh_ferias_parcelas?select=data_inicio&periodo_id=eq.${periodo.id}`, { headers: H })).json();
  const jaTem = new Set((ex || []).map((p) => p.data_inicio));
  // todas as linhas precisam ter as MESMAS chaves (PostgREST batch) -> sempre inclui confirmada_*
  const novas = ranges.filter((p) => !jaTem.has(p.data_inicio)).map((p) => {
    const passou = p.data_fim < hoje; // já gozada = confirmada; futura = programada
    return {
      periodo_id: periodo.id, colaborador_id: c.id, data_inicio: p.data_inicio, dias: p.dias, data_fim: p.data_fim,
      status: passou ? "confirmada" : "programada",
      confirmada_em: passou ? new Date().toISOString() : null,
      confirmada_por: passou ? ATOR : null,
    };
  });
  if (novas.length) {
    const rp = await fetch(`${URL}/rest/v1/rh_ferias_parcelas`, { method: "POST", headers: H, body: JSON.stringify(novas) });
    if (!rp.ok) { console.log(`  ✗ ${c.nome}: FALHA ao inserir parcelas (${rp.status}): ${(await rp.text()).slice(0, 160)}`); continue; }
    parcelas += novas.length;
    // ajusta status do período (programado se soma>=30)
    const todas = await (await fetch(`${URL}/rest/v1/rh_ferias_parcelas?select=dias&periodo_id=eq.${periodo.id}`, { headers: H })).json();
    const soma = (todas || []).reduce((s, p) => s + (p.dias || 0), 0);
    await fetch(`${URL}/rest/v1/rh_ferias_periodos?id=eq.${periodo.id}`, { method: "PATCH", headers: H, body: JSON.stringify({ status: soma >= 30 ? "programado" : "aberto" }) });
    console.log(`  ✓ ${c.nome}: +${novas.length} parcela(s) [${novas.map((p) => p.data_inicio + "→" + p.data_fim + " " + p.status).join(", ")}]`);
  }
}
console.log(`\nFIM. períodos criados: ${periodos} · parcelas inseridas: ${parcelas} · sem colaborador: ${semColab} · sem dados: ${semDados}`);
