// ============================================================================
// Importa o board "RH" do Monday para o módulo RH do portal.
//
//   - 96 colaboradores → rh_colaboradores (upsert por monday_id)
//   - ~300 documentos (RG, CNH, ASO, EPI, NRs, contratos, fichas)
//     → baixados das URLs assinadas do Monday e re-hospedados no bucket
//       PRIVADO "rh" do Supabase Storage (LGPD: dados pessoais sensíveis
//       nunca em bucket público) → rh_documentos (upsert por monday_asset_id)
//
// Pré-requisitos (gerados na sessão de importação):
//   D:/temp/monday-rh-mapeado.json    (itens do board com colunas + docs)
//   D:/temp/monday-assets-urls.json   (assetId → URL assinada, válida 1h)
//
// Idempotente. Uso: node scripts/importar-rh-monday.mjs
// ============================================================================

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(resolve(root, ".env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);
const URL_SB = env.PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const headers = { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json" };

const BUCKET = "rh"; // PRIVADO

const colaboradores = JSON.parse(readFileSync("D:/temp/monday-rh-mapeado.json", "utf8"));
const assets = JSON.parse(readFileSync("D:/temp/monday-assets-urls.json", "utf8"));

// ─── helpers ────────────────────────────────────────────────────────────────

async function garantirBucketPrivado() {
  const r = await fetch(`${URL_SB}/storage/v1/bucket/${BUCKET}`, { headers });
  if (r.ok) {
    const b = await r.json();
    if (b.public) {
      // segurança: se por algum motivo estiver público, torna privado
      await fetch(`${URL_SB}/storage/v1/bucket/${BUCKET}`, { method: "PUT", headers, body: JSON.stringify({ public: false }) });
      console.log("⚠ Bucket rh estava público — corrigido para PRIVADO");
    }
    return;
  }
  const cri = await fetch(`${URL_SB}/storage/v1/bucket`, {
    method: "POST", headers,
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }),
  });
  if (!cri.ok) throw new Error(`Falha ao criar bucket: ${await cri.text()}`);
  console.log(`✔ Bucket "${BUCKET}" criado (PRIVADO — acesso só por URL assinada)`);
}

function slug(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 60);
}

async function rest(method, path, body, prefer) {
  const r = await fetch(`${URL_SB}/rest/v1/${path}`, {
    method, headers: { ...headers, ...(prefer ? { prefer } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${t.slice(0, 250)}`);
  return t ? JSON.parse(t) : null;
}

function d(s) { return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null; }
function digitos(s) { return String(s || "").replace(/\D/g, ""); }

// status do Monday → status do módulo + regime por CPF/CNPJ
const STATUS_DESLIGADO = ["DESLIGADO", "CONTRATO ENCERRADO", "PEDIU DEMISSÃO", "ABANDONO DE EMPREGO", "FALECEU", "INATIVO", "ACORDO JUDICIAL", "AVISO TRABALHADO", "DESISTIU", "NÃO APROVADO"];
function mapStatus(st) {
  const s = (st || "").toUpperCase();
  if (STATUS_DESLIGADO.some((x) => s.includes(x))) return "desligado";
  if (s.includes("FÉRIAS")) return "ferias";
  if (s.includes("AFASTADO") || s.includes("SUSPENS")) return "afastado";
  return "ativo";
}

(async () => {
  console.log("Importação Monday RH → Portal CJR");
  await garantirBucketPrivado();

  // ── 1) Colaboradores ──
  console.log("\n■ Colaboradores");
  let novos = 0;
  const rows = colaboradores.map(({ mondayId, nome, cv }) => {
    const doc = digitos(cv.texto__1);
    const obsExtras = [
      cv.status ? `Status Monday: ${cv.status}` : null,
      cv.data2__1 ? `Venc. férias: ${cv.data2__1}` : null,
      cv.dup__of_venc_f_rias__1 ? `Limite gozo férias: ${cv.dup__of_venc_f_rias__1}` : null,
      cv.data85__1 ? `Fim 1º per. experiência: ${cv.data85__1}` : null,
      cv.data99__1 ? `Fim 2º per. experiência: ${cv.data99__1}` : null,
      cv.text_mkpbnxjj ? `Venc. ficha EPI: ${cv.text_mkpbnxjj}` : null,
      cv.dup__of_contato_pessoal_mkmgftjk ? `E-mail pessoal: ${cv.dup__of_contato_pessoal_mkmgftjk}` : null,
      cv.texto_2_mkkz75xn ? `Contato emergencial 2: ${cv.texto_2_mkkz75xn}` : null,
    ].filter(Boolean).join(" | ");
    return {
      monday_id: String(mondayId),
      nome: nome,
      email: cv.e_mail__1 || null,
      telefone: cv.texto_mkkzgghn || null,
      cpf: doc.length === 11 ? cv.texto__1 : null,
      data_nascimento: d(cv.data25__1) || d(cv.data8__1),
      cargo: cv.texto9__1 || null,
      regime: doc.length === 14 ? "pj" : "clt",
      salario: cv.n_meros__1 ? Number(cv.n_meros__1) : null,
      data_admissao: d(cv.data),
      data_desligamento: d(cv.data__1),
      status: mapStatus(cv.status),
      contato_emergencia_nome: cv.texto_1_mkkz85gm || null,
      observacoes: (doc.length === 14 ? `CNPJ: ${cv.texto__1} | ` : "") + obsExtras || null,
      criado_por: "importacao-monday",
    };
  });
  await rest("POST", "rh_colaboradores?on_conflict=monday_id", rows, "resolution=merge-duplicates,return=minimal");
  console.log(`  ✔ ${rows.length} colaboradores sincronizados`);

  // mapa monday_id → id supabase
  const colabSb = await rest("GET", "rh_colaboradores?select=id,monday_id&monday_id=not.is.null&limit=500");
  const mapaColab = new Map(colabSb.map((c) => [c.monday_id, c.id]));

  // ── 2) Documentos (download → bucket privado → registro) ──
  console.log("\n■ Documentos (download Monday → bucket privado rh)");
  let ok = 0, falhas = 0, semUrl = 0;
  for (const colab of colaboradores) {
    const idSb = mapaColab.get(String(colab.mondayId));
    if (!idSb || !colab.docs.length) continue;
    for (const doc of colab.docs) {
      const asset = assets[doc.assetId];
      if (!asset?.url) { semUrl++; continue; }
      try {
        // já importado?
        const ex = await rest("GET", `rh_documentos?select=id&monday_asset_id=eq.${doc.assetId}&limit=1`);
        if (ex.length) { ok++; continue; }

        const dl = await fetch(asset.url);
        if (!dl.ok) throw new Error(`download HTTP ${dl.status}`);
        const buf = Buffer.from(await dl.arrayBuffer());

        const path = `${slug(colab.nome)}-${colab.mondayId}/${doc.assetId}-${slug(asset.nome.replace(/\.[^.]+$/, ""))}${asset.ext || ""}`;
        const ct = asset.ext === ".pdf" ? "application/pdf" : asset.ext === ".png" ? "image/png" : "image/jpeg";
        const up = await fetch(`${URL_SB}/storage/v1/object/${BUCKET}/${path}`, {
          method: "POST",
          headers: { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": ct, "x-upsert": "true" },
          body: buf,
        });
        if (!up.ok) throw new Error(`upload ${await up.text()}`);

        await rest("POST", "rh_documentos", {
          colaborador_id: idSb,
          titulo: `${doc.titulo} — ${asset.nome}`,
          tipo: doc.tipo,
          validade: d(doc.validade),
          storage_path: path,
          monday_asset_id: doc.assetId,
          observacoes: "Importado do Monday",
          criado_por: "importacao-monday",
        }, "return=minimal");
        ok++;
        process.stdout.write(`\r  ${ok} documentos importados...`);
      } catch (e) {
        falhas++;
        console.error(`\n  ✘ ${colab.nome} / ${asset?.nome}: ${e.message.slice(0, 120)}`);
      }
    }
  }
  console.log(`\n  ✔ ${ok} documentos no bucket privado | falhas: ${falhas} | sem URL: ${semUrl}`);

  console.log("\n✅ Importação Monday RH concluída. Veja em https://costajr.com.br/admin/rh");
})().catch((e) => { console.error("✘ ERRO:", e.message); process.exit(1); });
