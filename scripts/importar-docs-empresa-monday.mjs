// ============================================================================
// Importa o board "DOCUMENTOS EMPRESA" (6803034312) do Monday para o módulo
// /admin/doc-empresa.
//
//   - 81 documentos → doc_empresa (upsert por monday_id), agrupados pela
//     "divisão atual" (os grupos do Monday) em CATEGORIAS.
//   - ~72 anexos → baixados das URLs assinadas do Monday e re-hospedados no
//     bucket PRIVADO "doc-empresa" do Supabase Storage (LGPD — RG sócios, CNH,
//     contratos) → doc_empresa_arquivos (upsert por monday_asset_id).
//
// Regra de validade (faithful ao Monday, sem falsos vencidos):
//   - documento "não aplicável" (validade_na=true) quando: não está numa
//     categoria de validade-rastreada, OU marcado "Sem validade"/0SEMVAL, OU
//     sem data válida.
//   - senão, a data da coluna VALIDADE vira o vencimento (gera alerta).
//
// Pré-requisito: D:/temp/doc-empresa-assets.json (assetId → {nome,ext,url},
//   gerado na sessão — URLs assinadas válidas ~1h). Sem ele, importa só a
//   metadata (sem baixar anexos).
//
// Idempotente. Uso: node scripts/importar-docs-empresa-monday.mjs
// ============================================================================

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(resolve(root, ".env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const URL_SB = env.PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const headers = { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json" };
const BUCKET = "doc-empresa"; // PRIVADO
const MAX_BYTES = 48 * 1024 * 1024; // limite de upload (apresentação institucional 62MB é pulada)

const ASSETS_PATH = "D:/temp/doc-empresa-assets.json";
const ASSETS = existsSync(ASSETS_PATH) ? JSON.parse(readFileSync(ASSETS_PATH, "utf8")) : {};

// ─── Categorias (a "divisão atual" = grupos do Monday) ───────────────────────
const EPS = "Empresas Prestadoras de Serviços";
const INT = "Integração";
const AP = "Análise Patrimonial";
const BAL = "Balancete";
const DIV = "Documentos Diversos";
const CFME = "Certidões Federal/Municipal/Estadual";
const CDJ = "Certidões e Declarações Jurídica";
const MOD = "Modelos";
const CC = "Contratos – Clientes";

const TRACKED = new Set([CFME, CDJ, DIV]); // categorias com validade rastreada
const PERIOD = new Set(["Mensal", "Anual", "Consulta Mensal"]);

// ─── Itens (snapshot do board em 14/06/2026; metadata estável e re-rodável) ──
// { id, cat, nome, val(validade bruta|null), status, cor(status validade), site, obs, ass[assetIds] }
const ITENS = [
  // EMPRESAS PRESTADORAS DE SERVIÇOS
  { id: "8370292659", cat: EPS, nome: "IF", status: "Consulta Mensal", ass: [] },
  { id: "8370323804", cat: EPS, nome: "ATIVO", ass: [] },
  { id: "8370324415", cat: EPS, nome: "VERISURE", ass: [] },
  { id: "8370326731", cat: EPS, nome: "ROTAEXATA", site: "https://www.loom.com/share/fec827f5463d4539bb00daf602730929", ass: ["2210440759", "2899112656", "2899112991"] },
  { id: "8370328908", cat: EPS, nome: "JR & F. JOGO", ass: ["2899109286", "2899110153"] },
  { id: "8370334072", cat: EPS, nome: "RUGAI", ass: [] },
  { id: "8370335498", cat: EPS, nome: "MOVIDA", ass: [] },
  { id: "8370339612", cat: EPS, nome: "MAKE", ass: [] },
  { id: "8370352806", cat: EPS, nome: "VHSYS", ass: [] },
  { id: "8370353391", cat: EPS, nome: "SL TECK", ass: [] },
  { id: "8370355588", cat: EPS, nome: "DIARIO DE OBRA", ass: [] },
  { id: "8370362468", cat: EPS, nome: "D4SIGN", ass: [] },
  { id: "8370370077", cat: EPS, nome: "CANVA", ass: [] },
  { id: "8370370961", cat: EPS, nome: "CHATGPT", ass: [] },
  { id: "8370428004", cat: EPS, nome: "NEOCODE ACTIVE", ass: [] },
  { id: "8370534935", cat: EPS, nome: "CONTROLID", ass: [] },
  { id: "8370551927", cat: EPS, nome: "ODONTOPREV", ass: [] },
  { id: "8370833172", cat: EPS, nome: "CONSISTE", ass: [] },
  { id: "18042661960", cat: EPS, nome: "VOBI", ass: ["2442835555"] },
  { id: "11745446759", cat: EPS, nome: "MÔNICA CONSULTORIA", ass: ["2899100155", "2899100157"] },
  // INTEGRAÇÃO
  { id: "6884191087", cat: INT, nome: "CÓDIGO DE CONDUTA", status: "Feito", val: "2024-06-22", ass: ["1523752813"] },
  { id: "6884191144", cat: INT, nome: "APRESENTAÇÃO INSTITUCIONAL", status: "Feito", val: "2024-06-21", ass: ["1535156337"] },
  // ANÁLISE PATRIMONIAL
  { id: "9159972637", cat: AP, nome: "Análise Patrimonial 2024", obs: "ATIVO", ass: ["2143880954"] },
  // BALANCETE
  { id: "9159948764", cat: BAL, nome: "Balancetes 2024", ass: ["2143874493"] },
  // DOCUMENTOS DIVERSOS
  { id: "6803324910", cat: DIV, nome: "DECLARAÇÃO DE DÉBITOS E CRÉDITOS TRIBUTOS FEDERAIS PREVIDENCIÁRIOS", ass: [] },
  { id: "6803034593", cat: DIV, nome: "CONTRATO SOCIAL - 5 ALT", status: "Feito", cor: "Sem validade", ass: ["1501906328"] },
  { id: "6803034631", cat: DIV, nome: "CARTÃO CNPJ", status: "Feito", cor: "Sem validade", site: "https://solucoes.receita.fazenda.gov.br/Servicos/cnpjreva/cnpjreva_Solicitacao.asp", ass: ["1518903437"] },
  { id: "6803034671", cat: DIV, nome: "RG SÓCIOS", status: "Feito", cor: "Sem validade", ass: ["1501905581", "1501905584"] },
  { id: "6803046069", cat: DIV, nome: "CNH SÓCIOS", status: "Feito", cor: "Sem validade", ass: ["1501940902", "1501940914"] },
  { id: "6803075523", cat: DIV, nome: "DRE", status: "Anual", cor: "Na Validade", ass: [] },
  { id: "6803083398", cat: DIV, nome: "BALANÇO", status: "Anual", cor: "Na Validade", ass: [] },
  { id: "6803092370", cat: DIV, nome: "FATURAMENTO", status: "Mensal", cor: "Vencido", ass: [] },
  { id: "6803098682", cat: DIV, nome: "CAU", status: "Feito", cor: "Sem validade", ass: ["1501904590", "1518920086"] },
  { id: "6803099557", cat: DIV, nome: "CREA", status: "Feito", cor: "Sem validade", ass: ["1518922519"] },
  { id: "6803114112", cat: DIV, nome: "FICHA CADASTRAL", status: "Feito", cor: "Sem validade", ass: [] },
  { id: "6803123859", cat: DIV, nome: "CADASTRO DE CONTRIBUINTE ICMS E INSCRIÇÃO ESTADUAL", status: "Feito", cor: "Sem validade", site: "http://www.sintegra.gov.br/  OU https://www.cadesp.fazenda.sp.gov.br", ass: ["1518989466"] },
  { id: "6803125435", cat: DIV, nome: "COMPROVANTE DOMICÍLIO BANCÁRIO", status: "Feito", cor: "Sem validade", ass: [] },
  { id: "6803222296", cat: DIV, nome: "FDC - INSCRIÇÃO MUNICIPAL", status: "Feito", cor: "Sem validade", val: "2024-09-19", site: "https://ccm.prefeitura.sp.gov.br/login/contribuinte?tipo=F", ass: ["1519113030"] },
  { id: "6803326244", cat: DIV, nome: "DEFIS", status: "Feito", cor: "Sem validade", ass: [] },
  { id: "6803333214", cat: DIV, nome: "NÚMERO DUNS", status: "Feito", cor: "Sem validade", ass: ["1519481923"] },
  { id: "6803349466", cat: DIV, nome: "PGDAS", status: "Feito", cor: "Sem validade", ass: [] },
  { id: "6867275674", cat: DIV, nome: "COMPROVANTE ENDEREÇO", cor: "Vencido", val: "2024-09-19", ass: ["1519479354"] },
  { id: "6867322567", cat: DIV, nome: "IMPOSTO DE RENDA SÓCIOS", ass: [] },
  { id: "6867339849", cat: DIV, nome: "BREVE RELATO", ass: ["1519496159"] },
  { id: "6909595370", cat: DIV, nome: "CERTIDÃO CASAMENTO", ass: ["1530404244"] },
  { id: "6967305382", cat: DIV, nome: "SEGURANÇA DO TRABALHO", ass: [] },
  { id: "6967730658", cat: DIV, nome: "GUIA INSS - COMP. ABRIL E MAIO/2024", ass: [] },
  { id: "6967732569", cat: DIV, nome: "GUIA FGTS/GFIP - COMP. MAIO/2024", ass: [] },
  { id: "7215845210", cat: DIV, nome: "SEGURO CARROS FROTA", status: "Na validade", val: "2026-07-10", ass: ["1614658016", "1614658022", "1614658023", "2291982005"] },
  { id: "7675912526", cat: DIV, nome: "CRLV DIGITAL - VEÍCULOS EMPRESA", status: "Feito", val: "2025-10-07", ass: ["1740972206", "1740972210", "1740988796"] },
  { id: "7678888738", cat: DIV, nome: "LINKS PARA ACOMPANHAMENTO DE DÍVIDAS", status: "Consulta Mensal", ass: [] },
  { id: "11950300490", cat: DIV, nome: "RELATÓRIO DE SITUAÇÃO FISCAL - COSTA JUNIOR", ass: [] },
  // CERTIDÕES FEDERAL, MUNICIPAL_ESTADUAL
  { id: "6803101803", cat: CFME, nome: "CERTIDÃO NEGATIVA DÉBITOS TRABALHISTAS", status: "Mensal", val: "2026-12-08", site: "https://www.tst.jus.br/certidao1", ass: ["2799676607", "3039147240"] },
  { id: "6803102771", cat: CFME, nome: "CND FEDERAL - CERTIDÃO POSITIVA C/ EFEITOS DE NEGATIVA (TRIBUTOS FEDERAIS E DÍVIDA ATIVA DA UNIÃO)", status: "Mensal", val: "2025-09-15", site: "https://solucoes.receita.fazenda.gov.br/Servicos/certidaointernet/PJ/Emitir", ass: ["2143495064"] },
  { id: "6803204434", cat: CFME, nome: "CND ESTADUAL - DÉBITOS TRIBUTÁRIOS NÃO INSCRITOS NA DÍVIDA ATIVA SP", status: "Mensal", val: "2025-10-05", ass: ["2143479549"] },
  { id: "6803251432", cat: CFME, nome: "CND MUNICIPAL - DÉBITOS DE TRIBUTOS MOBILIÁRIOS", status: "Mensal", val: "2025-07-27", site: "https://duc.prefeitura.sp.gov.br/certidoes/forms_anonimo/frmConsultaEmissaoCertificado.aspx", ass: ["2184354814"] },
  { id: "6803265306", cat: CFME, nome: "CERTIDÃO JUCESP / LICENCIAMENTO INTEGRADO - ALVARÁ DE FUNCIONAMENTO", status: "Mensal", val: "2025-08-25", ass: ["1518963607"] },
  { id: "6803277217", cat: CFME, nome: "CERTIDÃO SIMPLIFICADA JUCESP", status: "Sem validade", ass: ["1518975402"] },
  { id: "6865628174", cat: CFME, nome: "CERTIDÃO REGULARIDADE DO FGTS - CRF", status: "Mensal", val: "2026-06-21", site: "https://consulta-crf.caixa.gov.br/consultacrf/pages/consultaEmpregador.jsf", ass: ["2270038202", "2799770272", "3039150529"] },
  { id: "6867669637", cat: CFME, nome: "CERTIDÃO DÉBITOS E CRÉDITOS TRIBUTOS FEDERAIS PREVIDENCIÁRIOS", status: "Mensal", val: "2026-03-28", ass: ["2184371551"] },
  { id: "6867715889", cat: CFME, nome: "CERTIDÃO AÇÕES TRABALHISTAS", status: "Sem validade", cor: "Na Validade", site: "https://cndt-certidao.tst.jus.br/inicio.faces", ass: ["1996365132", "3039142882", "3039148954"] },
  { id: "6909443643", cat: CFME, nome: "CERTIDÃO NEGATIVA DE DÉBITOS INSCRITOS NA DÍVIDA ATIVA SP", status: "Mensal", val: "2026-04-30", site: "https://www.dividaativa.pge.sp.gov.br/sc/pages/crda/emitirCrda.jsf", obs: "CONTABILIDADE", ass: ["2270050084", "2799834662"] },
  { id: "7753249043", cat: CFME, nome: "CERTIDÕES DE PROTESTO (10 CARTÓRIOS)", status: "Parado", ass: ["1834735794", "1834735798", "1834735802", "1834735805", "1834735806", "1834735894", "1834735898", "1834735912", "1834735927", "1834735939"] },
  { id: "12261525548", cat: CFME, nome: "CERTIDÃO NEGATIVA DE DÉBITOS INSCRITOS NA DÍVIDA ATIVA SP (atualizada)", status: "Mensal", val: "2026-07-11", ass: ["3039146143"] },
  // CERTIDÕES E DECLARAÇÕES JURÍDICA
  { id: "9257209632", cat: CDJ, nome: "DECLARAÇÃO DE CUMPRIMENTO DA LEI ANTICORRUPÇÃO (ASSINAR)", ass: [] },
  { id: "9257257631", cat: CDJ, nome: "CERTIDÕES (pasta)", ass: [] },
  { id: "9257105420", cat: CDJ, nome: "CERTIDÃO FEDERAL CÍVEL - JFSP", cor: "Sem validade", ass: ["2170928790"] },
  { id: "9257205247", cat: CDJ, nome: "CERTIDÃO JUDICIAL CRIMINAL NEGATIVA - TRF3", cor: "Sem validade", ass: ["2170930395"] },
  { id: "9257205876", cat: CDJ, nome: "CERTIDÃO FEDERAL CÍVEL - TRF3", cor: "Sem validade", ass: ["2170931695"] },
  { id: "9257206574", cat: CDJ, nome: "CERTIDÃO ELETRÔNICA DE AÇÕES TRABALHISTAS (DIGITAL)", cor: "Sem validade", ass: ["2170938018"] },
  { id: "9257207397", cat: CDJ, nome: "CERTIDÃO JUDICIAL CRIMINAL NEGATIVA - JFSP", cor: "Sem validade", ass: ["2170938294"] },
  { id: "9257208034", cat: CDJ, nome: "CERTIDÃO TRABALHISTA PROCESSO FÍSICO", cor: "Na Validade", ass: ["2170938771"] },
  { id: "9301557563", cat: CDJ, nome: "CERTIDÃO ESTADUAL DE DISTRIBUIÇÃO CRIMINAIS / EXECUÇÃO CRIMINAL", cor: "Sem validade", ass: ["2184384542"] },
  { id: "9301566610", cat: CDJ, nome: "CERTIDÃO TJSP - CÍVEL / TRIBUTÁRIA / RECUPERAÇÃO JUDICIAL", cor: "Na Validade", ass: ["2184387858"] },
  { id: "9301581334", cat: CDJ, nome: "CERTIDÃO TJSP - AÇÕES CRIMINAIS", ass: [] },
  // MODELOS
  { id: "9257237980", cat: MOD, nome: "DECLARAÇÃO DE CUMPRIMENTO DA LEI ANTICORRUPÇÃO (modelo)", ass: ["2170941180"] },
  // CONTRATOS - CLIENTES
  { id: "9534306181", cat: CC, nome: "SANTANDER", ass: [] },
  { id: "9534307056", cat: CC, nome: "VIA VAREJO", ass: ["2272732160"] },
  { id: "9534307672", cat: CC, nome: "CARREFOUR", ass: [] },
  { id: "9534312996", cat: CC, nome: "ITAÚ", ass: ["2272842991"] },
  { id: "9534317155", cat: CC, nome: "BRADESCO", ass: [] },
];

// ─── helpers ──────────────────────────────────────────────────────────────
async function rest(method, path, body, prefer) {
  const r = await fetch(`${URL_SB}/rest/v1/${path}`, {
    method, headers: { ...headers, ...(prefer ? { prefer } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${t.slice(0, 250)}`);
  return t ? JSON.parse(t) : null;
}

async function garantirBucketPrivado() {
  const r = await fetch(`${URL_SB}/storage/v1/bucket/${BUCKET}`, { headers });
  if (r.ok) {
    const b = await r.json();
    if (b.public) {
      await fetch(`${URL_SB}/storage/v1/bucket/${BUCKET}`, { method: "PUT", headers, body: JSON.stringify({ public: false }) });
      console.log("⚠ Bucket doc-empresa estava público — corrigido para PRIVADO");
    }
    return;
  }
  const cri = await fetch(`${URL_SB}/storage/v1/bucket`, {
    method: "POST", headers,
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false, file_size_limit: 52428800 }),
  });
  if (!cri.ok) throw new Error(`Falha ao criar bucket: ${await cri.text()}`);
  console.log(`✔ Bucket "${BUCKET}" criado (PRIVADO — acesso só por URL assinada)`);
}

const CT = { ".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".doc": "application/msword", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };

function decide(it) {
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(it.val || "");
  const semval = it.cor === "Sem validade" || it.status === "Sem validade" || /SEMVAL/i.test(it.nome);
  let validade = null, validade_na = true;
  if (TRACKED.has(it.cat) && !semval && dateOk) { validade = it.val; validade_na = false; }
  let periodicidade = null;
  if (PERIOD.has(it.status)) periodicidade = it.status;
  else if (semval) periodicidade = "Sem validade";
  let site = null, obs = it.obs || null;
  if (it.site) { if (/^https?:\/\/\S+$/.test(it.site)) site = it.site; else obs = [obs, it.site].filter(Boolean).join(" | "); }
  return { validade, validade_na, periodicidade, site, observacoes: obs };
}

(async () => {
  console.log("Importação Monday DOCUMENTOS EMPRESA → /admin/doc-empresa\n");
  const temAssets = Object.keys(ASSETS).length > 0;
  if (!temAssets) console.log("⚠ Sem D:/temp/doc-empresa-assets.json — importando só a metadata (sem anexos).\n");
  if (temAssets) await garantirBucketPrivado();

  // ── 1) Documentos ──
  const rows = ITENS.map((it) => {
    const d = decide(it);
    return {
      monday_id: it.id,
      categoria: it.cat,
      nome: it.nome,
      periodicidade: d.periodicidade,
      validade: d.validade,
      validade_na: d.validade_na,
      site: d.site,
      observacoes: d.observacoes,
      criado_por: "importacao-monday",
    };
  });
  await rest("POST", "doc_empresa?on_conflict=monday_id", rows, "resolution=merge-duplicates,return=minimal");
  console.log(`■ ${rows.length} documentos sincronizados (upsert por monday_id)`);

  const docsSb = await rest("GET", "doc_empresa?select=id,monday_id&monday_id=not.is.null&limit=500");
  const mapaDoc = new Map(docsSb.map((d) => [d.monday_id, d.id]));

  // ── 2) Anexos ──
  if (!temAssets) { console.log("\n✅ Metadata importada. Rode de novo com o arquivo de assets para trazer os anexos."); return; }
  console.log("\n■ Anexos (download Monday → bucket privado doc-empresa)");
  let ok = 0, falhas = 0, semUrl = 0, grandes = 0, jaTinha = 0;
  for (const it of ITENS) {
    const docId = mapaDoc.get(it.id);
    if (!docId || !it.ass?.length) continue;
    for (const aid of it.ass) {
      const a = ASSETS[aid];
      if (!a?.url) { semUrl++; console.warn(`  ⚠ sem URL: asset ${aid} (${it.nome})`); continue; }
      try {
        const ex = await rest("GET", `doc_empresa_arquivos?select=id&monday_asset_id=eq.${aid}&limit=1`);
        if (ex.length) { jaTinha++; ok++; continue; }

        const dl = await fetch(a.url);
        if (!dl.ok) throw new Error(`download HTTP ${dl.status}`);
        const buf = Buffer.from(await dl.arrayBuffer());
        if (buf.length > MAX_BYTES) { grandes++; console.warn(`  ⏭ grande demais (${(buf.length / 1048576).toFixed(0)}MB), pulado: ${a.nome}`); continue; }

        const ext = (a.ext || "").toLowerCase();
        const path = `${docId}/${aid}${ext || ".bin"}`;
        const up = await fetch(`${URL_SB}/storage/v1/object/${BUCKET}/${path}`, {
          method: "POST",
          headers: { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": CT[ext] || "application/octet-stream", "x-upsert": "true" },
          body: buf,
        });
        if (!up.ok) throw new Error(`upload ${await up.text()}`);

        await rest("POST", "doc_empresa_arquivos", {
          doc_id: docId, nome: a.nome, storage_path: path, monday_asset_id: aid, criado_por: "importacao-monday",
        }, "return=minimal");
        ok++;
        process.stdout.write(`\r  ${ok} anexos no cofre...`);
      } catch (e) {
        falhas++;
        console.error(`\n  ✘ ${it.nome} / ${a?.nome}: ${String(e.message).slice(0, 140)}`);
      }
    }
  }
  console.log(`\n  ✔ ${ok} anexos (${jaTinha} já existiam) | falhas: ${falhas} | sem URL: ${semUrl} | grandes pulados: ${grandes}`);
  console.log("\n✅ Importação concluída. Veja em https://costajr.com.br/admin/doc-empresa");
})().catch((e) => { console.error("✘ ERRO:", e.message); process.exit(1); });
