#!/usr/bin/env node
/**
 * BOLETOS DE CARTÓRIO — roda NO COMPUTADOR da Adriana (tarefa agendada)
 * ---------------------------------------------------------------------------
 * POR QUE ESTE SCRIPT EXISTE (14/10/2026, pedido da Adriana):
 * Os tabelionatos de protesto respondem por e-mail mandando boletos (custas de
 * cancelamento, intimações). Ela quer que o boleto de CUSTAS de título já pago vá
 * para o grupo financeiro do Telegram (CJR_ADM) com o vencimento, já entre na
 * Vobi, e que os e-mails dos cartórios fiquem arquivados numa pasta própria do
 * Outlook. Intimação (PGFN ou de fornecedor) NÃO vai como boleto nem entra na
 * Vobi — "PGFN não tem como ser pago, quero apenas os boletos de custas do que
 * já está pago" (14/10/2026). Exceção: a guia da Prefeitura de Jundiaí que ela pediu.
 *
 * O QUE FAZ (uma passada; a tarefa agendada chama de novo a cada 15 min)
 *   1. Lê no Outlook (scripts/cartorio-outlook.ps1) os e-mails de cartório que
 *      chegaram na Caixa de Entrada nos últimos dias e salva os PDFs.
 *   2. Acha a linha digitável em cada PDF e tira valor e vencimento DELA (o
 *      vencimento impresso no corpo às vezes é o do título, não o do boleto).
 *   3. Vobi (só custas/guia — ver deveMandar): se já existe conta em aberto do
 *      mesmo cartório com o mesmo valor, só acerta o vencimento; se não existe,
 *      lança (fornecedor, categoria e centro de custo preenchidos).
 *   4. Manda o PDF no grupo CJR_ADM com valor, vencimento e linha digitável.
 *   5. Copia o PDF para AUDITORIA\02_Protestos\Boletos e intimacoes e move o
 *      e-mail para a pasta "Cartórios - Protestos" da Caixa de Entrada.
 *   E-mail de cartório sem boleto de custas (resposta, intimação): só avisa no
 *   grupo, numa linha, e arquiva.
 *
 * COMO USAR
 *   node scripts/cartorio-boletos.mjs            (uma passada)
 *   node scripts/cartorio-boletos.mjs --dry      (simula: não manda, não grava, não move)
 *   node scripts/cartorio-boletos.mjs --inicial  (não avisa e-mails sem boleto; 1ª carga)
 *   ATIVAR-BOLETOS-CARTORIO.cmd                  (agenda a cada 15 min, sem janela)
 *
 * Estado (o que já foi enviado) em %LOCALAPPDATA%\CJR\cartorio-boletos.json —
 * fora do OneDrive de propósito (sincronização no meio da gravação corrompe).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, rmSync, statSync, unlinkSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir, homedir } from "node:os";
import { extractText, getDocumentProxy } from "unpdf";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

function lerEnv() {
  const env = {};
  try {
    for (const linha of readFileSync(join(RAIZ, ".env"), "utf8").split(/\r?\n/)) {
      const m = linha.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch { /* sem .env → só variáveis de ambiente */ }
  return env;
}
const ENV = lerEnv();
const cfg = (k, padrao = "") => process.env[k] || ENV[k] || padrao;

const ARGS = process.argv.slice(2);
const DRY = ARGS.includes("--dry");
const INICIAL = ARGS.includes("--inicial");
// --da-pasta: rele a pasta de arquivo do Outlook em vez da Caixa de Entrada (só com --dry, p/ testar a regra)
const DA_PASTA = DRY && ARGS.includes("--da-pasta");
const DIAS = Number((ARGS.find((a) => a.startsWith("--dias=")) || "").split("=")[1]) || (INICIAL ? 4 : 3);

const TOKEN_TG = cfg("TELEGRAM_BOT_TOKEN_ADM");
const CHAT = cfg("TELEGRAM_CHAT_ADM");
const SB_URL = cfg("PUBLIC_SUPABASE_URL");
const SB_KEY = cfg("SUPABASE_SERVICE_ROLE_KEY");
const PASTA_OUTLOOK = cfg("CARTORIO_PASTA_OUTLOOK", "Cartórios - Protestos");
const ARQUIVO_PDFS = cfg(
  "CARTORIO_PASTA_PDFS",
  "D:\\OneDrive - Costa Jr\\Financeiro\\03_Contabilidade\\01_Documentos\\AUDITORIA\\02_Protestos\\Boletos e intimacoes",
);
const DIR_ESTADO = join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "CJR");
const ESTADO = cfg("CARTORIO_ESTADO", join(DIR_ESTADO, "cartorio-boletos.json"));
const TRAVA = join(tmpdir(), "cjr-cartorio-boletos.lock");
const PS1 = join(RAIZ, "scripts", "cartorio-outlook.ps1");

// Vobi (mesmos ids do bot — src/lib/vobiBaixa.ts)
const VOBI = "https://api.vobi.com.br/v2";
const ID_EMPRESA = 96840;
const ID_ENTIDADE = "04afa8bd-6159-44d0-95e4-e23bda31c8ae";
const CONTA_SANTANDER = 24582;
const FORMA_BOLETO = 2;
const CAT_CARTORIO = 21658033;      // Despesas Administrativas > Cartório
const CAT_IMPOSTOS_TAXAS = 22039501; // Despesas Administrativas > Impostos e taxas
const CC_ADMINISTRATIVO = 26762;
const CC_IMPOSTOS = 26630;           // 001_IMPOSTOS ENGENHARIA

// Remetente → cartório, pelo DOMÍNIO EXATO (âncora no fim do endereço: "protesto" solto
// aceitaria qualquer um). `fornecedores` = cadastros que já existem na Vobi para esse cartório
// (há duplicados: "2º TABELIÃO..." e "2. TABELIAO..."); quando não existe nenhum, cria com
// `nomeNovo` na primeira vez. `bancos` = banco dos boletos dele (3 primeiros dígitos da linha):
// boleto de outro banco vira só aviso — é o golpe clássico do boleto trocado.
const SP = ["341"]; // os tabeliães de SP emitem pelo Itaú (2º, 3º, 4º e 6º conferidos em 14/10/2026)
const CARTORIOS = [
  { rx: /@primeiroprotestosp\.com\.br$/i, rotulo: "1º Tabelião de Protesto", ord: "1°", fornecedores: [666129], bancos: SP },
  { rx: /@segundoprotestosp\.com\.br$/i, rotulo: "2º Tabelião de Protesto", ord: "2°", fornecedores: [717790, 931880], bancos: SP },
  { rx: /@3protesto-?sp\.com\.br$/i, rotulo: "3º Tabelião de Protesto", ord: "3°", fornecedores: [882209, 931883], bancos: SP },
  { rx: /@quartoprotestosp\.com\.br$/i, rotulo: "4º Tabelião de Protesto", ord: "4°", fornecedores: [], bancos: SP,
    nomeNovo: "4º TABELIÃO DE PROTESTO DE LETRAS E TÍTULOS DE SÃO PAULO - SP" },
  { rx: /@5protesto\.com\.br$/i, rotulo: "5º Tabelião de Protesto", ord: "5°", fornecedores: [717484], bancos: SP },
  { rx: /@(sextoprotestosp|6protsp)\.com\.br$/i, rotulo: "6º Tabelião de Protesto", ord: "6°", fornecedores: [868315], bancos: SP },
  { rx: /@setimoprotestosp\.com\.br$/i, rotulo: "7º Tabelião de Protesto", ord: "7°", fornecedores: [717503], bancos: SP },
  { rx: /@8tpsp\.com\.br$/i, rotulo: "8º Tabelião de Protesto", ord: "8°", fornecedores: [882212, 931878], bancos: SP },
  { rx: /@nonoprotestosp\.com\.br$/i, rotulo: "9º Tabelião de Protesto", ord: "9°", fornecedores: [], bancos: SP,
    nomeNovo: "9º TABELIÃO DE PROTESTO DE LETRAS E TÍTULOS DE SÃO PAULO - SP" },
  { rx: /@10tpsp\.com\.br$/i, rotulo: "10º Tabelião de Protesto", ord: "10°", fornecedores: [717801], bancos: SP },
  { rx: /@protestojundiai\.com\.br$/i, rotulo: "Tabelião de Protesto de Jundiaí", ord: "JUNDIAÍ", fornecedores: [], bancos: ["237"],
    nomeNovo: "TABELIÃO DE PROTESTO DE LETRAS E TÍTULOS DE JUNDIAÍ" },
  // só a caixa de Finanças da Prefeitura (que mandou a guia que a Adriana pediu)
  { rx: /^atendimentofinancas@jundiai\.sp\.gov\.br$/i, rotulo: "Prefeitura de Jundiaí", ord: "PREF. JUNDIAÍ", fornecedores: [],
    nomeNovo: "PREFEITURA MUNICIPAL DE JUNDIAÍ", imposto: true },
];
const cartorioPorRotulo = (rotulo) => CARTORIOS.find((c) => c.rotulo === rotulo);

const agoraTxt = () => new Date().toLocaleString("pt-BR");
const log = (...a) => console.log(`[${agoraTxt()}]`, ...a);
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const brl = (v) => "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hojeISO = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const dataBR = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "?");
const dataBRsem = (iso) => (iso ? `${dataBR(iso)} (${SEMANA[new Date(iso + "T12:00:00Z").getUTCDay()]})` : "?");
const norm = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const numBR = (s) => Number(String(s).replace(/\./g, "").replace(",", "."));

// ------------------------------------------------------------------ estado
function lerEstado() {
  try { return JSON.parse(readFileSync(ESTADO, "utf8")); } catch { return { emails: {}, boletos: {} }; }
}
function gravarEstado(e) {
  if (DRY) return;
  mkdirSync(DIR_ESTADO, { recursive: true });
  writeFileSync(ESTADO + ".tmp", JSON.stringify(e, null, 1));
  copyFileSync(ESTADO + ".tmp", ESTADO);
  unlinkSync(ESTADO + ".tmp");
}

// ------------------------------------------------------------------ código de barras
const somaMod10 = (s) => {
  let soma = 0, peso = 2;
  for (let i = s.length - 1; i >= 0; i--) {
    let n = Number(s[i]) * peso;
    if (n > 9) n = Math.floor(n / 10) + (n % 10);
    soma += n; peso = peso === 2 ? 1 : 2;
  }
  return (10 - (soma % 10)) % 10;
};

/** Boleto bancário (47 dígitos): confere os 3 dígitos verificadores dos campos. */
function boletoValido(ld) {
  return ld.length === 47 &&
    somaMod10(ld.slice(0, 9)) === Number(ld[9]) &&
    somaMod10(ld.slice(10, 20)) === Number(ld[20]) &&
    somaMod10(ld.slice(21, 31)) === Number(ld[31]);
}

/** Valor e vencimento saem da própria linha digitável. O fator de vencimento
 *  da FEBRABAN recomeçou em 22/02/2025 (fator 1000 = 22/02/2025). */
function lerBoleto(ld) {
  const fator = Number(ld.slice(33, 37));
  const valor = Number(ld.slice(37)) / 100;
  let venc = null;
  if (fator >= 1000) venc = new Date(Date.UTC(2025, 1, 22) + (fator - 1000) * 864e5).toISOString().slice(0, 10);
  return { codigo: ld, especie: "boleto", valor, venc };
}

/** Guia de arrecadação (48 dígitos, começa com 8): valor nas posições 5-15 do
 *  código de barras; vencimento não é padronizado — vem do texto. */
function lerArrecadacao(ld) {
  const barras = ld.slice(0, 11) + ld.slice(12, 23) + ld.slice(24, 35) + ld.slice(36, 47);
  const valor = /[6-9]/.test(barras[2]) ? Number(barras.slice(4, 15)) / 100 : 0;
  return { codigo: ld, especie: "guia", valor, venc: null };
}

function formatarCodigo(c) {
  if (c.startsWith("sem-linha:")) return "(linha digitável só na imagem do PDF — use o código de barras)";
  if (c.length === 47) {
    return `${c.slice(0, 5)}.${c.slice(5, 10)} ${c.slice(10, 15)}.${c.slice(15, 21)} ${c.slice(21, 26)}.${c.slice(26, 32)} ${c[32]} ${c.slice(33)}`;
  }
  return [0, 12, 24, 36].map((i) => `${c.slice(i, i + 11)}-${c[i + 11]}`).join(" ");
}

function acharCodigos(texto) {
  const t = texto.replace(/\s+/g, " ");
  const achados = new Set();
  for (const m of t.matchAll(/\d{5}\.?\s?\d{5}\s+\d{5}\.?\s?\d{6}\s+\d{5}\.?\s?\d{6}\s+\d\s+\d{14}/g)) achados.add(m[0].replace(/\D/g, ""));
  for (const m of t.matchAll(/(?<!\d)\d{47}(?!\d)/g)) achados.add(m[0]);
  for (const m of t.matchAll(/(?<!\d)8\d{10}[-\s]?\d\s+\d{11}[-\s]?\d\s+\d{11}[-\s]?\d\s+\d{11}[-\s]?\d(?!\d)/g)) achados.add(m[0].replace(/\D/g, ""));
  for (const m of t.matchAll(/(?<!\d)8\d{47}(?!\d)/g)) achados.add(m[0]);
  const out = [];
  for (const c of achados) {
    if (c.length === 47 && boletoValido(c)) out.push(lerBoleto(c));
    else if (c.length === 48 && c[0] === "8") out.push(lerArrecadacao(c));
  }
  return out;
}

// ------------------------------------------------------------------ leitura do PDF
async function textoDoPdf(caminho) {
  const pdf = await getDocumentProxy(new Uint8Array(readFileSync(caminho)));
  const { text } = await extractText(pdf, { mergePages: true });
  return String(text || "").replace(/\s+/g, " ");
}

/** Nome de quem mandou o título a protesto, nos formatos dos cartórios de SP. */
function credorDe(t) {
  const padroes = [
    // 4º (cancelamento). Maiúsc./minúsc. importa: o 3º tem "FAVORECIDO" de cabeçalho de tabela.
    /Favorecido\s+([A-Z0-9][A-Z0-9 .&-]+?)\s+Apresentante/,
    /SACADOR:\s*(.+?)\s+(?:-|CNPJ|CPF|Composi)/i,                          // 2º e 6º (intimação)
    /N[°º]T[íi]tulo\s+\d+\s*-\s*[\d/]+\s+R\$\s*[\d.,]+\s+[\d/]+\s+\d+([A-Z][A-Z0-9 .&-]+?)\s+(?:DV|Instru)/i, // 2º (cancelamento)
    /NESTE NOME\s+(.+?)\s+\d{6,}/i,                                        // 3º
  ];
  for (const p of padroes) {
    const m = t.match(p);
    if (!m) continue;
    let s = m[1].trim();
    const w = s.split(" "); // o 3º repete o nome duas vezes seguidas
    if (w.length % 2 === 0 && w.slice(0, w.length / 2).join(" ") === w.slice(w.length / 2).join(" ")) s = w.slice(0, w.length / 2).join(" ");
    if (s.length >= 3) return s.slice(0, 70);
  }
  return "";
}

function detalhesDe(t) {
  const protocolo =
    (t.match(/Protocolo(?:\s+e\s+Data)?\s*:?\s*(\d{3,5})\s*-\s*\d{2}\/\d{2}\/\d{4}/i) ||
     t.match(/DIG\.\s*(\d{3,5})\s*-\s*\d{2}\/\d{2}\/\d{4}/i) ||
     t.match(/N[°º]T[íi]tulo\s+(\d{3,5})\s*-\s*\d{2}\/\d{2}\/\d{4}/i) || [])[1] || "";
  const titulo = (t.match(/N[úu]mero do T[íi]tulo\s+([A-Z0-9./-]+)/i) || [])[1] || "";
  const m = t.match(/Valor a Protestar\s+(?:Custas|Emolumentos)\s+Valor a Pagar\s+R\$\s*([\d.,]+)\s+R\$\s*([\d.,]+)\s+R\$\s*([\d.,]+)/i);
  return {
    protocolo, titulo,
    valorTitulo: m ? numBR(m[1]) : null,
    custas: m ? numBR(m[2]) : null,
  };
}

function tipoDe(t, cart) {
  // INTIMAÇÃO PRIMEIRO: o texto padrão dela cita "para requerer o cancelamento do protesto"
  // (modelos do 1º, 5º, 7º e 9º). Estas marcas estão nas 11 intimações conferidas em 14/10/2026
  // e em nenhum dos boletos de custas.
  if (/PRAZO LIMITE|INTIMAMOS|fica V\.?\s?S[ªa.]*\s*intimad/i.test(t)) return "intimacao";
  // frases do boleto de custas de cancelamento ("cancelamento do protesto" é a do tabelião de Jundiaí)
  if (/BOLETO PARA CANCELAMENTO|AUTORIZA[ÇC][ÃA]O PARA CANCELAMENTO|custas (?:do|para o|de) cancelamento|cancelamento do protesto/i.test(t)) return "cancelamento";
  if (/INTIMA/i.test(t)) return "intimacao";
  if (cart.imposto) return "guia";
  return "outro";
}

/** PGFN pelo texto inteiro (o credor extraído falha no modelo do 5º). Serve só de RÓTULO:
 *  quem decide se manda é o tipo (custas de CDA já quitada também vale). */
const ehPgfn = (t) => /PROCURADORIA[- ]GERAL DA FAZENDA|FAZENDA NACIONAL/i.test(t);

/** Boleto de banco que esse cartório não usa → não manda nem lança (golpe do boleto trocado). */
function bancoInesperado(b) {
  if (!b.cart.bancos || !/^\d{47}$/.test(b.codigo)) return "";
  const banco = b.codigo.slice(0, 3);
  return b.cart.bancos.includes(banco) ? "" : `boleto de banco inesperado (${banco})`;
}

function vencimentoNoTexto(t) {
  const m = t.match(/Vencimento\s*:?\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  // Guia em tabela (Prefeitura de Jundiaí): o cabeçalho vem longe do valor. Na
  // guia a emissão é sempre <= vencimento, então vale a MAIOR data perto de hoje
  // (até 30 dias para trás: guia lida depois do vencimento tem de cair em "vencida").
  const hoje = hojeISO();
  const de = new Date(Date.parse(hoje) - 30 * 864e5).toISOString().slice(0, 10);
  const ate = new Date(Date.parse(hoje) + 120 * 864e5).toISOString().slice(0, 10);
  const datas = [...t.matchAll(/(\d{2})\/(\d{2})\/(\d{4})/g)].map((x) => `${x[3]}-${x[2]}-${x[1]}`).filter((d) => d >= de && d <= ate);
  return datas.length ? datas.sort().at(-1) : null;
}

/** Boleto cuja linha digitável é IMAGEM (ex.: Bradesco do cartório de Jundiaí):
 *  sem código no texto, mas com valor e vencimento escritos. Vai como "veja o PDF". */
function boletoSemLinha(t, pdf) {
  if (!/Ficha de Compensa|Benefici[aá]rio|Boleto/i.test(t)) return null;
  const v = t.match(/Valor (?:do )?Documento\s*:?\s*R\$\s*([\d.,]+)/i);
  const d = t.match(/Data de Vencimento\s*:?\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  if (!v || !d) return null;
  const hash = createHash("sha1").update(readFileSync(pdf)).digest("hex").slice(0, 16);
  return { codigo: `sem-linha:${hash}`, especie: "boleto", valor: numBR(v[1]), venc: `${d[3]}-${d[2]}-${d[1]}` };
}

/** O PDF às vezes é de OUTRO cartório que o remetente (a Prefeitura de Jundiaí
 *  mandou junto o boleto de custas do tabelião de lá). Quem recebe manda. */
function cartorioDoPdf(t, cartEmail) {
  if (/Benefici[aá]rio:?\s*TABELI[AÃ]O DE PROTESTO DE LETRAS E T[IÍ]TULOS DE J/i.test(t)) return cartorioPorRotulo("Tabelião de Protesto de Jundiaí");
  return cartEmail;
}

const refDe = (t, assunto) => ((`${assunto} ${t}`).match(/CDA\s*(?:n[ºo°.]*\s*)?(\d[\d.\-/]{5,}\d)/i) || [])[1] || "";

// ------------------------------------------------------------------ Telegram
const pausa = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function tg(metodo, fd) {
  for (let tentativa = 1; ; tentativa++) {
    const r = await fetch(`https://api.telegram.org/bot${TOKEN_TG}/${metodo}`, { method: "POST", body: fd });
    const j = await r.json().catch(() => ({}));
    if (j.ok) { await pausa(1200); return j; } // espaça os envios (limite do Telegram por grupo)
    const espera = Number(j.parameters?.retry_after) || 0;
    if (j.error_code === 429 && espera && tentativa < 3) { await pausa(Math.min(espera, 60) * 1000); continue; }
    throw new Error(`Telegram ${metodo}: ${j.description || r.status}`);
  }
}
async function mandarTexto(texto) {
  if (DRY) { console.log("\n[TELEGRAM texto]\n" + texto); return; }
  const fd = new FormData();
  fd.append("chat_id", CHAT); fd.append("text", texto);
  fd.append("parse_mode", "HTML"); fd.append("disable_web_page_preview", "true");
  return tg("sendMessage", fd);
}
async function mandarPdf(caminho, legenda) {
  if (DRY) { console.log(`\n[TELEGRAM pdf ${basename(caminho)}]\n` + legenda); return; }
  const fd = new FormData();
  fd.append("chat_id", CHAT);
  fd.append("document", new Blob([readFileSync(caminho)], { type: "application/pdf" }), basename(caminho));
  fd.append("caption", legenda.slice(0, 1024)); fd.append("parse_mode", "HTML");
  return tg("sendDocument", fd);
}

// ------------------------------------------------------------------ Supabase (cache de fornecedores + log)
const sbCab = () => ({ apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "User-Agent": "cjr-cli/1.0", "Content-Type": "application/json" });
async function fornecedoresDoCache() {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/vobi_cache?chave=eq.fornecedores&select=dados`, { headers: sbCab() });
    const j = await r.json();
    if (Array.isArray(j?.[0]?.dados)) return j[0].dados;
  } catch { /* cai na Vobi */ }
  const lista = [];
  for (let off = 0; off < 6000; off += 500) {
    const j = await vobi("GET", `/supplier?limit=500&offset=${off}`);
    for (const f of j.rows || []) lista.push({ id: f.id, nome: f.name || "", razao: f.companyName || "" });
    if ((j.rows || []).length < 500) break;
  }
  return lista;
}
async function limparCacheFornecedores() {
  try { await fetch(`${SB_URL}/rest/v1/vobi_cache?chave=eq.fornecedores`, { method: "DELETE", headers: sbCab() }); } catch { /* expira em 24h */ }
}
async function registrarLog(acao, registro_id, descricao, dados) {
  if (DRY) return;
  try {
    await fetch(`${SB_URL}/rest/v1/audit_log`, {
      method: "POST", headers: sbCab(),
      body: JSON.stringify({
        usuario_email: "robo-cartorios (computador da Adriana)", usuario_role: "robo",
        acao, entidade: "vobi_lancamento", registro_id: registro_id ? String(registro_id) : null, descricao, dados,
      }),
    });
  } catch { /* log é best-effort */ }
}

// ------------------------------------------------------------------ Vobi
let JWT = null;
async function vobi(metodo, caminho, corpo) {
  if (!JWT) {
    const basic = Buffer.from(`${cfg("VOBI_UUID")}:${cfg("VOBI_SECRET")}`).toString("base64");
    const a = await fetch(`${VOBI}/auth/token`, { method: "POST", headers: { Authorization: `Basic ${basic}` } });
    if (!a.ok) throw new Error(`Vobi auth: HTTP ${a.status}`);
    JWT = (await a.json()).jwt;
  }
  const r = await fetch(VOBI + caminho, {
    method: metodo,
    headers: { Authorization: `Bearer ${JWT}`, "Content-Type": "application/json" },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  if (r.status === 429) throw new Error("a Vobi bateu o limite de consultas da hora (tento de novo na próxima passada)");
  const tx = await r.text();
  if (!r.ok) throw new Error(`Vobi ${metodo} ${caminho.split("?")[0]}: HTTP ${r.status} ${tx.slice(0, 160)}`);
  return tx ? JSON.parse(tx) : {};
}
/** Parcelas desse fornecedor com esse valor, em aberto (status 1) e pagas (2..11; 12 = cancelada fica de fora). */
async function parcelasDoValor(idSupplier, valor) {
  const rows = (await vobi("GET", `/installment?limit=100&where[price]=${valor.toFixed(2)}&where[$payment.idSupplier$]=${idSupplier}`)).rows || [];
  return {
    abertas: rows.filter((i) => i.idInstallmentStatus === 1),
    pagas: rows.filter((i) => i.idInstallmentStatus >= 2 && i.idInstallmentStatus <= 11),
  };
}
const parcelasDoLancamento = async (idPayment) =>
  ((await vobi("GET", `/installment?limit=20&where[idPayment]=${idPayment}`)).rows || []).filter((i) => i.idPayment === idPayment);

let _forn = null;
async function fornecedores() { return (_forn ??= await fornecedoresDoCache()); }

async function idsDoCartorio(cart) {
  if (cart.fornecedores.length) return cart.fornecedores;
  const alvo = norm(cart.nomeNovo);
  const existente = (await fornecedores()).find((f) => norm(f.nome) === alvo);
  if (existente) return [existente.id];
  if (DRY) return [-1];
  const criado = await vobi("POST", "/supplier", { name: cart.nomeNovo });
  if (!criado?.id) throw new Error("a Vobi não devolveu o id do fornecedor novo");
  await limparCacheFornecedores();
  _forn = null;
  log("fornecedor criado na Vobi:", criado.id, cart.nomeNovo);
  return [Number(criado.id)];
}

/** Troca o vencimento de um lançamento de UMA parcela (PUT /payment com a
 *  parcela SEM id — ela é recriada; PUT /installment com dueDate é ignorado). */
async function mudarVencimento(parc, venc) {
  const irmas = await parcelasDoLancamento(parc.idPayment);
  if (irmas.length !== 1) return { ok: false, msg: `o lançamento tem ${irmas.length} parcelas — não mexi; ajuste o vencimento na Vobi` };
  const i = irmas[0];
  const preco = Number(i.price);
  const forma = i.idPaymentType || FORMA_BOLETO;
  await vobi("PUT", `/payment/${parc.idPayment}`, {
    value: preco,
    paymentTypes: [{ value: forma }],
    installments: [{
      price: preco, percentage: 100, number: i.number ?? 1, dueDate: venc,
      description: i.description || "Parcela 1", idInstallmentStatus: 1, idPaymentType: forma,
      ...(i.idPaymentBankAccount ? { idPaymentBankAccount: i.idPaymentBankAccount } : {}),
    }],
  });
  const depois = await parcelasDoLancamento(parc.idPayment);
  const ok = depois.length === 1 && String(depois[0].dueDate).slice(0, 10) === venc && Math.abs(Number(depois[0].price) - preco) < 0.01;
  return { ok, msg: ok ? "" : "a Vobi aceitou mas a releitura não bateu — confira o vencimento" };
}

async function criarLancamento({ nome, valor, venc, idSupplier, idCategoria, idCentroCusto, anotacao }) {
  nome = String(nome).toUpperCase().slice(0, 120);
  const parcela = {
    price: valor, percentage: 100, number: 1, dueDate: venc, idInstallmentStatus: 1,
    idPaymentBankAccount: CONTA_SANTANDER, idPaymentType: FORMA_BOLETO, description: nome,
  };
  const corpo = {
    name: nome, billType: "expense", value: valor, subTotal: valor, billingDate: hojeISO(),
    idPaymentBankAccount: CONTA_SANTANDER, idFinancialCategory: idCategoria,
    idPaymentCostCenter: idCentroCusto, idSupplier, ownBusiness: true,
    idCompany: ID_EMPRESA, idCompanyEntity: ID_ENTIDADE, idPaymentStatus: 2,
    paymentTypes: [{ value: FORMA_BOLETO }], annotation: anotacao,
    isRecurrence: false, recurrenceId: null, interval: 0, frequency: null, lastRecurrenceDate: null,
    installments: [parcela],
  };
  const criado = await vobi("POST", "/payment", corpo);
  if (!criado?.id) throw new Error("a Vobi não devolveu o id do lançamento");
  let ps = await parcelasDoLancamento(criado.id);
  if (!ps.length) {
    // O POST às vezes cria o cabeçalho e engole a parcela (memória vobi_baixa_pagamento).
    await vobi("PUT", `/payment/${criado.id}`, { value: valor, paymentTypes: [{ value: FORMA_BOLETO }], installments: [parcela] });
    ps = await parcelasDoLancamento(criado.id);
  }
  const ok = ps.length === 1 && Math.abs(Number(ps[0].price) - valor) < 0.01 && String(ps[0].dueDate).slice(0, 10) === venc;
  return { id: criado.id, ok };
}

/** O que o robô manda e lança (regra da Adriana, 14/10/2026): SÓ boleto de custas
 *  de cancelamento — o credor já autorizou, ou seja, o título já está pago — e a
 *  guia da Prefeitura que ela mesma pediu (ISS de Jundiaí). Intimação (PGFN ou de
 *  fornecedor) é cobrança do título em si: não vai como boleto nem entra na Vobi,
 *  só vira um aviso no grupo. PGFN não se paga por boleto de cartório — mas custas de
 *  cancelamento de uma CDA já quitada (por DARF) valem: quem decide é o TIPO. */
function deveMandar(b) {
  if (b.tipo === "cancelamento") return true;
  return b.tipo === "guia" && !!b.cart.imposto;
}

// Palavras de credor que não identificam ninguém.
const GENERICAS = new Set(["DISTR", "LTDA", "COMERCIO", "SERVICOS", "SOLUCOES", "TRIBUTARIAS", "ENGENHARIA", "MATERIAIS", "CONSTRUCAO", "BRASIL"]);
/** A conta aberta na Vobi é deste boleto? Valor igual não basta (as custas têm tabela: 71,85 aparece em
 *  vários títulos). Exige o protocolo, uma palavra do credor ou a CDA no nome do lançamento. */
function casaComBoleto(descricao, b) {
  const d = ` ${norm(descricao)} `;
  if (b.protocolo && d.includes(` PROT ${b.protocolo} `)) return true;
  if (b.ref && d.includes(` ${norm(b.ref)} `)) return true;
  return norm(b.credor).split(" ").some((w) => w.length >= 5 && !GENERICAS.has(w) && d.includes(` ${w} `));
}

/** Decide o que fazer na Vobi com um boleto. Nunca cancela nem apaga nada.
 *  `usados` = lançamentos já tocados nesta passada (dois boletos nunca caem no mesmo). */
async function registrarNaVobi(b, usados = new Set()) {
  if (!deveMandar(b)) return { acao: "pulado", txt: "não lancei — não é custas de título já pago" };
  if (!b.venc) return { acao: "pulado", txt: "não lancei — não consegui ler o vencimento" };
  if (!(b.valor > 0)) return { acao: "pulado", txt: "não lancei — não consegui ler o valor" };

  const cart = b.cart;
  const idsCart = await idsDoCartorio(cart);

  // 1) A conta deste título já está aberta num cadastro deste cartório? Só acerta o vencimento.
  let outrasDoMesmoValor = 0;
  for (const idS of idsCart.filter((x) => x > 0)) {
    const { abertas: todas0, pagas } = await parcelasDoValor(idS, b.valor);
    // 0) JÁ PAGO (nos últimos 90 dias)? Então este boleto não sai — evita pagar duas vezes.
    const desde = new Date(Date.parse(hojeISO()) - 90 * 864e5).toISOString().slice(0, 10);
    const paga = pagas.find((i) => casaComBoleto(i.description, b) && String(i.paidDate || "").slice(0, 10) >= desde);
    if (paga) return { acao: "ja_pago", id: paga.idPayment, txt: `já consta PAGO na Vobi em ${dataBR(String(paga.paidDate).slice(0, 10))} (${esc(paga.description || "")})` };
    const todas = todas0.filter((i) => !usados.has(i.idPayment));
    const abertas = todas.filter((i) => casaComBoleto(i.description, b));
    outrasDoMesmoValor += todas.length - abertas.length;
    const mesma = abertas.find((i) => String(i.dueDate).slice(0, 10) === b.venc);
    if (mesma) { usados.add(mesma.idPayment); return { acao: "ja_existia", id: mesma.idPayment, txt: `já estava lançado com esse vencimento (${esc(mesma.description || "")})` }; }
    if (abertas.length === 1) {
      const i = abertas[0];
      usados.add(i.idPayment);
      const antes = String(i.dueDate).slice(0, 10);
      if (DRY) return { acao: "atualizado", id: i.idPayment, txt: `SIMULAÇÃO — mudaria o vencimento de ${dataBR(antes)} para ${dataBR(b.venc)} (${esc(i.description || "")})` };
      const r = await mudarVencimento(i, b.venc);
      await registrarLog("editar", i.idPayment, `${i.description || "lançamento"} — vencimento ${dataBR(antes)} → ${dataBR(b.venc)} (boleto do ${cart.rotulo})`, { valor: b.valor, codigo: b.codigo });
      return r.ok
        ? { acao: "atualizado", id: i.idPayment, txt: `vencimento atualizado de ${dataBR(antes)} para ${dataBR(b.venc)} (${esc(i.description || "")})` }
        : { acao: "erro", id: i.idPayment, txt: r.msg };
    }
    if (abertas.length > 1) return { acao: "pulado", txt: `há ${abertas.length} contas de ${brl(b.valor)} desse credor em aberto nesse cartório — não sei qual é; ajuste na Vobi` };
  }
  const alerta = outrasDoMesmoValor ? ` — atenção: já havia ${outrasDoMesmoValor} conta(s) de ${brl(b.valor)} aberta(s) nesse cartório com outro nome; confira se não é a mesma` : "";

  // 2) Lança.
  let idSupplier, idCategoria, idCentroCusto, nome;
  const prot = b.protocolo ? `_PROT ${b.protocolo}` : "";
  if (b.tipo === "guia") {
    idSupplier = idsCart[0]; idCategoria = CAT_IMPOSTOS_TAXAS; idCentroCusto = CC_IMPOSTOS;
    nome = `GUIA_${cart.rotulo}${b.ref ? "_CDA " + b.ref : ""}`;
  } else {
    idSupplier = idsCart[0]; idCategoria = CAT_CARTORIO; idCentroCusto = CC_ADMINISTRATIVO;
    const quem = /^\d/.test(cart.ord) ? `${cart.ord} TABELIÃO` : cart.rotulo;
    nome = `BAIXA DE PROTESTO_${quem}_${b.credor || (b.ref ? "CDA " + b.ref : "CREDOR A CONFIRMAR")}${prot}`;
  }
  const anotacao = `Lançado pelo robô de boletos de cartório a partir do e-mail de ${b.de} (${dataBR(b.dataEmail.slice(0, 10))}). Linha digitável: ${formatarCodigo(b.codigo)}`;
  if (DRY) return { acao: "criado", id: "(simulação)", txt: `SIMULAÇÃO — lançaria "${nome.toUpperCase()}" (fornecedor ${idSupplier}, categoria ${idCategoria}, cc ${idCentroCusto})${alerta}` };
  const r = await criarLancamento({ nome, valor: b.valor, venc: b.venc, idSupplier, idCategoria, idCentroCusto, anotacao });
  usados.add(r.id);
  await registrarLog("criar", r.id, `${nome.toUpperCase()} — ${brl(b.valor)} vence em ${dataBR(b.venc)}${r.ok ? "" : " (CONFERIR NA VOBI)"}`, { valor: b.valor, venc: b.venc, fornecedor: idSupplier, codigo: b.codigo });
  return r.ok
    ? { acao: "criado", id: r.id, txt: `lançado como conta a pagar (${esc(nome.toUpperCase())})${alerta}` }
    : { acao: "erro", id: r.id, txt: "lançado, mas a releitura não bateu — confira na Vobi" };
}

// ------------------------------------------------------------------ mensagens
function descricaoDe(b) {
  if (b.tipo === "guia") return `Guia de pagamento${b.ref ? " — CDA " + esc(b.ref) : ""}`;
  return `Custas do cancelamento do protesto (título já pago)${b.credor ? " · credor " + esc(b.credor) : b.ref ? " · CDA " + esc(b.ref) : ""}`;
}
function legendaDe(b) {
  const vobiTxt = b.vobi
    ? (b.vobi.acao === "criado" || b.vobi.acao === "atualizado" || b.vobi.acao === "ja_existia" ? "✅ " : b.vobi.acao === "erro" ? "⚠️ " : "ℹ️ ") + b.vobi.txt
    : "⏳ não consegui falar com a Vobi agora — tento de novo sozinho";
  return [
    `💳 <b>BOLETO — ${esc(b.cart.rotulo)}</b>`,
    descricaoDe(b),
    `Valor: <b>${brl(b.valor)}</b> · vence <b>${dataBRsem(b.venc)}</b>`,
    `<code>${formatarCodigo(b.codigo)}</code>`,
    `Vobi: ${vobiTxt}`,
    b.especie === "boleto" ? "Só pelo boleto (cartório não aceita PIX/TED) e não recebe depois do vencimento." : "",
  ].filter(Boolean).join("\n");
}

// ------------------------------------------------------------------ Outlook
function powershell(argsPs) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", PS1, ...argsPs], { encoding: "utf8", timeout: 5 * 60 * 1000, windowsHide: true });
  if (r.status !== 0) throw new Error(`Outlook: ${String(r.stderr || r.stdout || r.error || "falhou").slice(0, 300)}`);
  return String(r.stdout || "").trim();
}

function travaOcupada() {
  try { return Date.now() - statSync(TRAVA).mtimeMs < 20 * 60 * 1000; } catch { return false; }
}

// ------------------------------------------------------------------ passada
function textoAviso({ e, cart, vencidos, ignorados, naoLidos, suspeito }) {
  const linhas = [`📨 <b>${esc(cart.rotulo)}</b> respondeu: ${esc(e.assunto)}`];
  if (suspeito) linhas.push("⚠️ Este e-mail NÃO passou na verificação do remetente (SPF): pode ser falso. Não mandei boleto nem lancei nada — confira com o cartório antes de pagar.");
  for (const b of ignorados) {
    const rot = b.motivo
      ? `⚠️ ${b.motivo}`
      : b.tipo === "intimacao" ? `Intimação${b.pgfn ? " da PGFN" : b.credor ? " (" + esc(b.credor) + ")" : ""}` : "Boleto que não é de custas";
    linhas.push(`• ${rot} — ${brl(b.valor)}${b.venc ? ", vence " + dataBR(b.venc) : ""}`);
  }
  if (ignorados.some((b) => !b.motivo) && !suspeito) linhas.push("Não é custas de título já pago: não mandei o boleto nem lancei na Vobi.");
  if (vencidos.length) linhas.push(`⚠️ Veio boleto de custas, mas já vencido em ${[...new Set(vencidos.map((v) => dataBR(v.venc)))].join(", ")} — precisa pedir outro.`);
  if (naoLidos.length) linhas.push(`📎 Não consegui ler: ${naoLidos.map(esc).join(", ")} — confira no e-mail.`);
  linhas.push(`O e-mail está na pasta <b>${esc(PASTA_OUTLOOK)}</b> do Outlook.`);
  return linhas.join("\n");
}
const ehRespostaAutomatica = (assunto) => /^(resposta autom[aá]tica|automatic reply|auto:)/i.test(String(assunto || "").trim());

async function main() {
  if (ARGS.includes("--da-pasta") && !DRY) throw new Error("--da-pasta só funciona junto com --dry (é só para testar a regra)");
  if (!DRY && (!TOKEN_TG || !CHAT)) throw new Error("TELEGRAM_BOT_TOKEN_ADM / TELEGRAM_CHAT_ADM não estão no .env");
  if (travaOcupada()) { log("outra passada em andamento — saindo"); return; }
  writeFileSync(TRAVA, String(process.pid));
  const tmp = join(tmpdir(), `cjr-cartorio-${process.pid}-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  try {
    const estado = lerEstado();
    const saida = join(tmp, "emails.json");
    powershell(["-modo", "listar", "-dias", String(DIAS), "-pasta", join(tmp, "anexos"), "-saida", saida, "-pastaOutlook", PASTA_OUTLOOK, "-origem", DA_PASTA ? "arquivo" : "inbox"]);
    let emails = JSON.parse(readFileSync(saida, "utf8").replace(/^﻿/, "") || "[]");
    if (!Array.isArray(emails)) emails = [emails];

    const hoje = hojeISO();
    const fila = [];       // um item por e-mail novo
    const aMover = [];     // e-mails processados que ainda estão na Caixa de Entrada
    for (const e of emails) {
      const cart = CARTORIOS.find((c) => c.rx.test(e.de));
      if (!cart) continue;
      if (estado.emails[e.id]) { if (!estado.emails[e.id].movido) aMover.push(e.id); continue; }
      const item = { e, cart, boletos: [], vencidos: [], ignorados: [], naoLidos: [], suspeito: !/^pass$/i.test(e.spf || "") };
      for (const pdf of [].concat(e.anexos || [])) {
        let texto = "";
        try { texto = await textoDoPdf(pdf); } catch (err) { log("PDF ilegível:", basename(pdf), err.message); item.naoLidos.push(basename(pdf)); continue; }
        const codigos = acharCodigos(texto);
        if (!codigos.length) { const s = boletoSemLinha(texto, pdf); if (s) codigos.push(s); }
        if (!codigos.length) { if (texto.trim().length < 40) item.naoLidos.push(basename(pdf)); continue; } // PDF imagem
        const cartPdf = cartorioDoPdf(texto, cart);
        // copia para a pasta da auditoria (nunca sobrescreve)
        const destino = join(ARQUIVO_PDFS, `${e.data.slice(0, 10)}_${e.data.slice(11, 16).replace(":", "")}_${(e.de.split("@")[1] || "cartorio")}_${basename(pdf)}`);
        if (!DRY && existsSync(ARQUIVO_PDFS) && !existsSync(destino)) copyFileSync(pdf, destino);
        const tipo = tipoDe(texto, cartPdf);
        const det = { ...detalhesDe(texto), ref: refDe(texto, e.assunto) };
        const credor = credorDe(texto);
        const pgfn = ehPgfn(texto);
        for (const c of codigos) {
          if (!c.venc) c.venc = vencimentoNoTexto(texto);
          const b = { ...c, ...det, tipo, credor, pgfn, cart: cartPdf, de: e.de, assunto: e.assunto, dataEmail: e.data, pdf };
          if (estado.boletos[c.codigo]?.telegram) continue;
          if (!deveMandar(b)) { item.ignorados.push(b); continue; }
          const motivo = item.suspeito ? "e-mail sem verificação do remetente" : bancoInesperado(b);
          if (motivo) { b.motivo = motivo; item.ignorados.push(b); continue; }
          if (c.venc && c.venc < hoje) { item.vencidos.push(b); continue; }
          item.boletos.push(b);
        }
      }
      fila.push(item);
    }

    // ---- resumo (2+ boletos), depois boleto a boleto: Vobi primeiro (a legenda conta o que foi feito)
    const novos = fila.flatMap((i) => i.boletos).sort((a, b) => String(a.venc).localeCompare(String(b.venc)));
    // Vobi ANTES do resumo: boleto que já consta pago sai do resumo e não vai como PDF
    const usados = new Set();
    for (const b of novos) {
      try { b.vobi = await registrarNaVobi(b, usados); } catch (err) { log("Vobi falhou:", b.codigo, err.message); b.vobi = null; b.erroVobi = err.message; }
    }
    const aPagar = novos.filter((b) => b.vobi?.acao !== "ja_pago");
    if (aPagar.length >= 2) {
      const total = aPagar.reduce((s, b) => s + b.valor, 0);
      try {
        await mandarTexto([
          `📌 <b>${aPagar.length} boletos de cartório chegaram</b> — vão logo abaixo, um por um:`,
          ...aPagar.map((b) => `• ${dataBR(b.venc)} — <b>${brl(b.valor)}</b> — ${esc(b.cart.rotulo)} — ${esc(b.credor || (b.ref ? "CDA " + b.ref : b.tipo))}`),
          `Total: <b>${brl(total)}</b>`,
        ].join("\n"));
      } catch (err) { log("resumo não foi:", err.message); }
    }
    let enviados = 0;
    for (const item of fila) {
      let completo = true;
      for (const b of item.boletos.sort((x, y) => String(x.venc).localeCompare(String(y.venc)))) {
        try {
          // já pago: não manda o PDF (alguém poderia pagar de novo) — só avisa
          if (b.vobi?.acao === "ja_pago") await mandarTexto(`✅ <b>${esc(b.cart.rotulo)}</b>: chegou de novo o boleto de ${brl(b.valor)} (vence ${dataBR(b.venc)}), mas ele ${b.vobi.txt}. Não mandei o boleto para não pagar duas vezes.`);
          else await mandarPdf(b.pdf, legendaDe(b));
        } catch (err) { log("Telegram falhou:", err.message); completo = false; continue; }
        // grava NA HORA: uma falha mais adiante não pode fazer este boleto sair de novo
        estado.boletos[b.codigo] = {
          telegram: new Date().toISOString(), cartorio: b.cart.rotulo, valor: b.valor, venc: b.venc, tipo: b.tipo,
          credor: b.credor, ref: b.ref, pgfn: b.pgfn, protocolo: b.protocolo, titulo: b.titulo, valorTitulo: b.valorTitulo, custas: b.custas,
          de: b.de, dataEmail: b.dataEmail, vobi: b.vobi || { acao: "pendente", erro: b.erroVobi },
        };
        gravarEstado(estado);
        enviados++;
        log("boleto enviado:", b.cart.rotulo, brl(b.valor), b.venc, "| Vobi:", b.vobi?.acao || "pendente");
      }
      // ---- aviso do e-mail (sem boleto de custas, intimação, vencido, anexo ilegível, remetente suspeito)
      const temNovidade = !item.boletos.length || item.ignorados.length || item.vencidos.length || item.naoLidos.length || item.suspeito;
      const quieto = ehRespostaAutomatica(item.e.assunto) && !item.ignorados.length && !item.vencidos.length && !item.naoLidos.length;
      if (!INICIAL && temNovidade && !quieto) {
        try { await mandarTexto(textoAviso(item)); } catch (err) { log("aviso não foi:", err.message); completo = false; }
      }
      // só arquiva o e-mail processado inteiro; o resto fica na Caixa de Entrada para a próxima passada
      if (completo) { estado.emails[item.e.id] = { visto: new Date().toISOString(), movido: false }; gravarEstado(estado); aMover.push(item.e.id); }
    }

    // ---- Vobi que ficou para depois (limite de consultas etc.)
    for (const [codigo, s] of Object.entries(estado.boletos)) {
      if (s.vobi?.acao !== "pendente" || novos.some((b) => b.codigo === codigo)) continue;
      if (s.venc && s.venc < hoje) { s.vobi = { acao: "pulado", txt: "venceu antes de conseguir lançar" }; gravarEstado(estado); continue; }
      const cart = cartorioPorRotulo(s.cartorio);
      if (!cart) continue;
      try {
        const r = await registrarNaVobi({ ...s, codigo, cart, especie: codigo.length === 48 ? "guia" : "boleto" }, usados);
        s.vobi = r;
        gravarEstado(estado);
        await mandarTexto(`🔁 Vobi atualizada — boleto de <b>${brl(s.valor)}</b> (${esc(s.cartorio)}, vence ${dataBR(s.venc)}): ${r.txt}`);
      } catch (err) { log("Vobi ainda falhando:", codigo, err.message); }
    }

    // ---- arquiva no Outlook e marca SÓ o que o Outlook confirmou ter movido
    let movidos = 0;
    if (aMover.length && !DRY) {
      const arqIds = join(tmp, "ids.txt");
      writeFileSync(arqIds, aMover.join("\n"), "utf8");
      const out = powershell(["-modo", "mover", "-ids", arqIds, "-pastaOutlook", PASTA_OUTLOOK]);
      for (const m of out.matchAll(/^movido: (\S+)/gm)) {
        if (estado.emails[m[1]]) { estado.emails[m[1]].movido = true; movidos++; }
      }
      if (/falhou:/.test(out)) log(out.split(/\r?\n/).filter((l) => /falhou:/.test(l)).join(" | "));
      gravarEstado(estado);
    }
    if (fila.length || aMover.length) {
      log(`passada concluída: ${enviados} boleto(s), ${fila.length} e-mail(s) novo(s), ${DRY ? `simulação (${aMover.length} seriam arquivados)` : `${movidos} arquivado(s)`}`);
    }
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* temporário */ }
    try { unlinkSync(TRAVA); } catch { /* já saiu */ }
  }
}

main().catch((e) => { log("✖", e?.message || e); process.exit(1); });
