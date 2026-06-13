// Corrige regime (CLT/PJ/diarista) e status (ativo/inativo) dos colaboradores do
// RH a partir do GRUPO do board Monday (fonte de verdade) — substitui a heurística
// de documento que deixava todos como CLT. Idempotente (PATCH por monday_id).
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n").filter(l => l.includes("=") && !l.startsWith("#"))
    .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);
const SB = env.SUPABASE_URL || env.PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
const h = { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json" };

// Grupos do board RH (6629107099) → ids dos itens (Monday). Fonte: get_board_info + all_monday_api.
const GRUPOS = {
  "Ativos Gestão - CLT": { regime: "clt", ativo: true, ids: ["6629107314","6713529546","6713456500","6713456458"] },
  "Ativos Operação -CLT": { regime: "clt", ativo: true, ids: ["7254785941","7335010451","8526965710"] },
  "Ativos - PJ": { regime: "pj", ativo: true, ids: ["6713456235","6713456284","6713456546","11010560657"] },
  "Diaristas": { regime: "temporario", ativo: true, ids: ["11664246336","11664246223","11664254085","11664246883","11664263478","11664276674","11664280524","11664324468","11664324232","11756717518","11756735030","11756728367","11839132898"] },
  "PJ_INATIVOS 2025": { regime: "pj", ativo: false, ids: ["7054911602","6923155243","7116522203","6713456184","6923152955","7355683345","6923154525","7227301082","7054882589","7602757524","6713456212","6713456264","8451863293","7510893729","8057499131","8451747313","8246671660","8831723362","6962714431","8451757651"] },
  "PJ_INATIVOS 2026": { regime: "pj", ativo: false, ids: ["9840280980","18264637989","18033954949","11515313929","11530996778","10763268435"] },
  "CLT_INATIVOS 2025": { regime: "clt", ativo: false, ids: ["6713456354","6713456410","6923128958","6713456523","6923130822","6923142318","7054662978","7054817450","7054255539","6713456480","6923135467","7054532658","7182294881","7306558969","7254787256","7052015428","7182308514","7409553620","7054816421","7306561280","7409537496","7054218975","7054610351","7426060858","7054274146","7054819191","7602790817","7688583517","7334986044","7306560039","7335009698","6713456306","6713456332","7334990046","7617691823","7773085091","7773256348","7254783984","7999384790","7054167875","8582562978","7409533247","7617694157","7306563447"] },
  "CLT_INATIVOS 2026": { regime: "clt", ativo: false, ids: ["7306562042","6713456374"] },
};

// status do Monday (cv.status) → nuance dentro dos ativos
const mapeado = JSON.parse(readFileSync("D:/temp/monday-rh-mapeado.json", "utf8"));
const arr = Array.isArray(mapeado) ? mapeado : Object.values(mapeado).find(Array.isArray);
const statusMonday = new Map(arr.map(it => [String(it.mondayId), String(it.cv?.status || "").toUpperCase()]));
function statusAtivo(mondayId) {
  const s = statusMonday.get(String(mondayId)) || "";
  if (s === "FÉRIAS" || s === "FERIAS") return "ferias";
  if (s === "AFASTADO" || s.includes("SUSPENS")) return "afastado";
  return "ativo";
}

const rest = async (method, path, body) => {
  const r = await fetch(`${SB}/rest/v1/${path}`, { method, headers: { ...h, prefer: "return=minimal" }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${(await r.text()).slice(0, 200)}`);
};

let total = 0, naoEncontrados = [];
const resumo = { clt_ativo: 0, pj_ativo: 0, outros_ativo: 0, clt_inativo: 0, pj_inativo: 0, outros_inativo: 0 };

for (const [titulo, g] of Object.entries(GRUPOS)) {
  for (const mid of g.ids) {
    const status = g.ativo ? statusAtivo(mid) : "desligado";
    const patch = { regime: g.regime, status, updated_at: new Date().toISOString() };
    // só desligado ganha data_desligamento se ainda não tiver
    try {
      await rest("PATCH", `rh_colaboradores?monday_id=eq.${mid}`, patch);
      total++;
      const reg = g.regime === "pj" ? "pj" : g.regime === "clt" ? "clt" : "outros";
      resumo[`${reg}_${g.ativo ? "ativo" : "inativo"}`]++;
    } catch (e) {
      naoEncontrados.push(mid + " (" + e.message.slice(0, 60) + ")");
    }
  }
}

console.log(`Atualizados: ${total} colaboradores`);
console.log("Distribuição:", JSON.stringify(resumo, null, 1));
if (naoEncontrados.length) console.log("Não atualizados:", naoEncontrados.slice(0, 10));

// confere no banco
const r = await fetch(`${SB}/rest/v1/rh_colaboradores?select=status,regime`, { headers: h });
const d = await r.json();
const st = {}, rg = {};
d.forEach(c => { st[c.status] = (st[c.status] || 0) + 1; rg[c.regime || "(null)"] = (rg[c.regime || "(null)"] || 0) + 1; });
console.log("Banco agora — status:", JSON.stringify(st), "| regime:", JSON.stringify(rg));
