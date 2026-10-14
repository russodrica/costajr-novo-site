#!/usr/bin/env node
/**
 * BOLETOS DE CARTÓRIO — roda NO COMPUTADOR da Adriana (tarefa agendada)
 * ---------------------------------------------------------------------------
 * POR QUE ESTE SCRIPT EXISTE (14/10/2026, pedido da Adriana):
 * Os tabelionatos de protesto respondem por e-mail mandando boletos (custas de
 * cancelamento, intimações). Ela quer que TODO boleto que chegar vá para o grupo
 * financeiro do Telegram (CJR_ADM) com o vencimento, já entre na Vobi, e que os
 * e-mails dos cartórios fiquem arquivados numa pasta própria do Outlook.
 *
 * O QUE FAZ (uma passada; a tarefa agendada chama de novo a cada 15 min)
 *   1. Lê no Outlook (scripts/cartorio-outlook.ps1) os e-mails de cartório que
 *      chegaram na Caixa de Entrada nos últimos dias e salva os PDFs.
 *   2. Acha a linha digitável em cada PDF e tira valor e vencimento DELA (o
 *      vencimento impresso no corpo às vezes é o do título, não o do boleto).
 *   3. Vobi: se já existe conta em aberto do mesmo cartório com o mesmo valor,
 *      só acerta o vencimento; se não existe, lança (fornecedor, categoria e
 *      centro de custo preenchidos). Intimação da PGFN NÃO é lançada (a dívida
 *      já é controlada na aba Situação Financeira do portal).
 *   4. Manda o PDF no grupo CJR_ADM com valor, vencimento e linha digitável.
 *   5. Copia o PDF para AUDITORIA\02_Protestos\Boletos e intimacoes e move o
 *      e-mail para a pasta "Cartórios - Protestos" da Caixa de Entrada.
 *   E-mail de cartório SEM boleto: só avisa no grupo e arquiva.
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
const ESTADO = join(DIR_ESTADO, "cartorio-boletos.json");
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

// Remetente → cartório. `fornecedores` = cadastros que já existem na Vobi para
// esse cartório (há duplicados: "2º TABELIÃO..." e "2. TABELIAO..."). Quando não
// existe nenhum, cria com `nomeNovo` na primeira vez que precisar.
const CARTORIOS = [
  { rx: /primeiroprotestosp/i, rotulo: "1º Tabelião de Protesto", ord: "1°", fornecedores: [666129] },
  { rx: /segundoprotestosp/i, rotulo: "2º Tabelião de Protesto", ord: "2°", fornecedores: [717790, 931880] },
  { rx: /3protesto/i, rotulo: "3º Tabelião de Protesto", ord: "3°", fornecedores: [882209, 931883] },
  { rx: /quartoprotestosp/i, rotulo: "4º Tabelião de Protesto", ord: "4°", fornecedores: [],
    nomeNovo: "4º TABELIÃO DE PROTESTO DE LETRAS E TÍTULOS DE SÃO PAULO - SP" },
  { rx: /5protesto/i, rotulo: "5º Tabelião de Protesto", ord: "5°", fornecedores: [717484] },
  { rx: /sextoprotestosp|6protsp/i, rotulo: "6º Tabelião de Protesto", ord: "6°", fornecedores: [868315] },
  { rx: /setimoprotestosp/i, rotulo: "7º Tabelião de Protesto", ord: "7°", fornecedores: [717503] },
  { rx: /8tpsp/i, rotulo: "8º Tabelião de Protesto", ord: "8°", fornecedores: [882212, 931878] },
  { rx: /nonoprotestosp/i, rotulo: "9º Tabelião de Protesto", ord: "9°", fornecedores: [],
    nomeNovo: "9º TABELIÃO DE PROTESTO DE LETRAS E TÍTULOS DE SÃO PAULO - SP" },
  { rx: /10tpsp/i, rotulo: "10º Tabelião de Protesto", ord: "10°", fornecedores: [717801] },
  { rx: /protestojundiai/i, rotulo: "Tabelião de Protesto de Jundiaí", ord: "JUNDIAÍ", fornecedores: [],
    nomeNovo: "TABELIÃO DE PROTESTO DE LETRAS E TÍTULOS DE JUNDIAÍ" },
  { rx: /jundiai\.sp\.gov\.br/i, rotulo: "Prefeitura de Jundiaí", ord: "PREF. JUNDIAÍ", fornecedores: [],
    nomeNovo: "PREFEITURA MUNICIPAL DE JUNDIAÍ", imposto: true },
];

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
  // frases que só aparecem no boleto de custas (a intimação cita "cancelamento" nas instruções)
  if (/BOLETO PARA CANCELAMENTO|AUTORIZA[ÇC][ÃA]O PARA CANCELAMENTO|custas (?:do|para o|de) cancelamento|cancelamento do protesto/i.test(t)) return "cancelamento";
  if (/INTIMA/i.test(t)) return "intimacao";
  if (cart.imposto) return "guia";
  return "outro";
}

function vencimentoNoTexto(t) {
  const m = t.match(/Vencimento\s*:?\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  // Guia em tabela (Prefeitura de Jundiaí): o cabeçalho vem longe do valor. Na
  // guia a emissão é sempre <= vencimento, então vale a MAIOR data perto de hoje.
  const hoje = hojeISO();
  const ate = new Date(Date.parse(hoje) + 120 * 864e5).toISOString().slice(0, 10);
  const datas = [...t.matchAll(/(\d{2})\/(\d{2})\/(\d{4})/g)].map((x) => `${x[3]}-${x[2]}-${x[1]}`).filter((d) => d >= hoje && d <= ate);
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
  if (/Benefici[aá]rio:?\s*TABELI[AÃ]O DE PROTESTO DE LETRAS E T[IÍ]TULOS DE J/i.test(t)) return CARTORIOS.find((c) => c.rx.test("protestojundiai"));
  return cartEmail;
}

const refDe = (t, assunto) => ((`${assunto} ${t}`).match(/CDA\s*(?:n[ºo°.]*\s*)?(\d[\d.\-/]{5,}\d)/i) || [])[1] || "";

// ------------------------------------------------------------------ Telegram
async function tg(metodo, fd) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN_TG}/${metodo}`, { method: "POST", body: fd });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(`Telegram ${metodo}: ${j.description || r.status}`);
  return j;
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
const parcelasAbertas = async (idSupplier, valor) =>
  ((await vobi("GET", `/installment?limit=50&where[idInstallmentStatus]=1&where[price]=${valor.toFixed(2)}&where[$payment.idSupplier$]=${idSupplier}`)).rows || []);
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

const VAZIAS = new Set(["LTDA", "ME", "EPP", "SA", "S", "A", "EIRELI", "DE", "DA", "DO", "DOS", "DAS", "E", "COMERCIO", "SERVICOS", "DISTR"]);
async function fornecedorDoCredor(credor) {
  const palavras = norm(credor).split(" ").filter((w) => w.length >= 3 && !VAZIAS.has(w));
  if (palavras.length < 2) return null;
  let melhor = null;
  for (const f of await fornecedores()) {
    const alvo = " " + norm(`${f.nome} ${f.razao || ""}`) + " ";
    const bate = palavras.filter((w) => alvo.includes(` ${w} `)).length;
    if (bate >= Math.min(palavras.length, 3) && (!melhor || bate > melhor.bate)) melhor = { ...f, bate };
  }
  return melhor;
}
async function categoriaUsualDo(idSupplier) {
  try {
    const j = await vobi("GET", `/payment?limit=10&where[idSupplier]=${idSupplier}&order[0][0]=id&order[0][1]=DESC`);
    const c = new Map();
    for (const r of j.rows || []) if (r.idFinancialCategory) c.set(r.idFinancialCategory, (c.get(r.idFinancialCategory) || 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  } catch { return null; }
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

/** Decide o que fazer na Vobi com um boleto. Nunca cancela nem apaga nada. */
async function registrarNaVobi(b) {
  if (b.pgfn) return { acao: "pulado", txt: "não lancei — é dívida da PGFN, já controlada na aba Situação Financeira (lanço se você decidir pagar)" };
  if (!b.venc) return { acao: "pulado", txt: "não lancei — não consegui ler o vencimento" };
  if (!(b.valor > 0)) return { acao: "pulado", txt: "não lancei — não consegui ler o valor" };

  const cart = b.cart;
  const idsCart = await idsDoCartorio(cart);
  const credorForn = b.tipo === "intimacao" && b.credor ? await fornecedorDoCredor(b.credor) : null;

  // 1) Intimação: a conta ORIGINAL do credor já está lançada? Então não duplica.
  if (credorForn && b.valorTitulo) {
    const orig = await parcelasAbertas(credorForn.id, b.valorTitulo);
    if (orig.length) {
      return { acao: "pulado", txt: `a conta original de ${brl(b.valorTitulo)} (${esc(credorForn.nome)}, venc. ${dataBR(String(orig[0].dueDate).slice(0, 10))}) já está lançada — pague o boleto e dê baixa nela; as custas (${brl(b.custas || 0)}) entram à parte` };
    }
  }

  // 2) Mesmo valor já em aberto num cadastro deste cartório (ou do credor)?
  const candidatos = [...idsCart, ...(credorForn ? [credorForn.id] : [])].filter((x) => x > 0);
  for (const idS of candidatos) {
    const abertas = await parcelasAbertas(idS, b.valor);
    const mesma = abertas.find((i) => String(i.dueDate).slice(0, 10) === b.venc);
    if (mesma) return { acao: "ja_existia", id: mesma.idPayment, txt: `já estava lançado com esse vencimento (${esc(mesma.description || "")})` };
    if (abertas.length === 1) {
      const i = abertas[0];
      const antes = String(i.dueDate).slice(0, 10);
      if (DRY) return { acao: "atualizado", id: i.idPayment, txt: `SIMULAÇÃO — mudaria o vencimento de ${dataBR(antes)} para ${dataBR(b.venc)} (${esc(i.description || "")})` };
      const r = await mudarVencimento(i, b.venc);
      await registrarLog("editar", i.idPayment, `${i.description || "lançamento"} — vencimento ${dataBR(antes)} → ${dataBR(b.venc)} (boleto do ${cart.rotulo})`, { valor: b.valor, codigo: b.codigo });
      return r.ok
        ? { acao: "atualizado", id: i.idPayment, txt: `vencimento atualizado de ${dataBR(antes)} para ${dataBR(b.venc)} (${esc(i.description || "")})` }
        : { acao: "erro", id: i.idPayment, txt: r.msg };
    }
    if (abertas.length > 1) return { acao: "pulado", txt: `há ${abertas.length} contas de ${brl(b.valor)} em aberto nesse cartório — não sei qual é; ajuste na Vobi` };
  }

  // 3) Lança.
  let idSupplier, idCategoria, idCentroCusto, nome;
  const prot = b.protocolo ? `_PROT ${b.protocolo}` : "";
  if (b.tipo === "intimacao") {
    idSupplier = credorForn?.id || idsCart[0];
    idCategoria = (credorForn && (await categoriaUsualDo(credorForn.id))) || CAT_CARTORIO;
    idCentroCusto = CC_ADMINISTRATIVO;
    const comp = b.valorTitulo && b.custas ? ` (TÍTULO ${brl(b.valorTitulo)} + CUSTAS ${brl(b.custas)})` : "";
    nome = `PROTESTO ${cart.ord} TABELIÃO_${b.credor || "CREDOR A CONFIRMAR"}${b.titulo ? "_TÍTULO " + b.titulo : ""}${comp}`;
  } else if (b.tipo === "guia" || cart.imposto) {
    idSupplier = idsCart[0]; idCategoria = CAT_IMPOSTOS_TAXAS; idCentroCusto = CC_IMPOSTOS;
    nome = `GUIA_${cart.rotulo}${b.ref ? "_CDA " + b.ref : ""}`;
  } else {
    idSupplier = idsCart[0]; idCategoria = CAT_CARTORIO; idCentroCusto = CC_ADMINISTRATIVO;
    const quem = /^\d/.test(cart.ord) ? `${cart.ord} TABELIÃO` : cart.rotulo;
    nome = `BAIXA DE PROTESTO_${quem}_${b.credor || (b.ref ? "CDA " + b.ref : "CREDOR A CONFIRMAR")}${prot}`;
  }
  const anotacao = `Lançado pelo robô de boletos de cartório a partir do e-mail de ${b.de} (${dataBR(b.dataEmail.slice(0, 10))}). Linha digitável: ${formatarCodigo(b.codigo)}`;
  if (DRY) return { acao: "criado", id: "(simulação)", txt: `SIMULAÇÃO — lançaria "${nome.toUpperCase()}" (fornecedor ${idSupplier}, categoria ${idCategoria}, cc ${idCentroCusto})` };
  const r = await criarLancamento({ nome, valor: b.valor, venc: b.venc, idSupplier, idCategoria, idCentroCusto, anotacao });
  await registrarLog("criar", r.id, `${nome.toUpperCase()} — ${brl(b.valor)} vence em ${dataBR(b.venc)}${r.ok ? "" : " (CONFERIR NA VOBI)"}`, { valor: b.valor, venc: b.venc, fornecedor: idSupplier, codigo: b.codigo });
  return r.ok
    ? { acao: "criado", id: r.id, txt: `lançado como conta a pagar (${esc(nome.toUpperCase())})` }
    : { acao: "erro", id: r.id, txt: "lançado, mas a releitura não bateu — confira na Vobi" };
}

// ------------------------------------------------------------------ mensagens
function descricaoDe(b) {
  if (b.pgfn) return `Intimação da PGFN${b.titulo ? " — inscrição " + esc(b.titulo) : ""} (pagar quita a inscrição inteira)`;
  if (b.tipo === "cancelamento") return `Custas do cancelamento do protesto${b.credor ? " · credor " + esc(b.credor) : b.ref ? " · CDA " + esc(b.ref) : ""}`;
  if (b.tipo === "intimacao") {
    const comp = b.valorTitulo && b.custas ? ` (título ${brl(b.valorTitulo)} + custas ${brl(b.custas)})` : "";
    return `Intimação — pagar evita o protesto${b.credor ? " · credor " + esc(b.credor) : ""}${comp}`;
  }
  if (b.tipo === "guia") return `Guia de pagamento${b.ref ? " — CDA " + esc(b.ref) : ""}`;
  return "Boleto";
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
async function main() {
  if (!DRY && (!TOKEN_TG || !CHAT)) throw new Error("TELEGRAM_BOT_TOKEN_ADM / TELEGRAM_CHAT_ADM não estão no .env");
  if (travaOcupada()) { log("outra passada em andamento — saindo"); return; }
  writeFileSync(TRAVA, String(process.pid));
  const tmp = join(tmpdir(), `cjr-cartorio-${process.pid}-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  try {
    const estado = lerEstado();
    const saida = join(tmp, "emails.json");
    powershell(["-modo", "listar", "-dias", String(DIAS), "-pasta", join(tmp, "anexos"), "-saida", saida, "-pastaOutlook", PASTA_OUTLOOK]);
    let emails = JSON.parse(readFileSync(saida, "utf8").replace(/^\uFEFF/, "") || "[]");
    if (!Array.isArray(emails)) emails = [emails];

    const hoje = hojeISO();
    const novos = [];      // boletos para mandar
    const avisos = [];     // e-mails sem boleto válido
    const mover = [];
    for (const e of emails) {
      const cart = CARTORIOS.find((c) => c.rx.test(e.de));
      if (!cart) continue;
      mover.push(e.id);
      if (estado.emails[e.id]) continue;
      const doEmail = [];
      const vencidos = [];
      for (const pdf of [].concat(e.anexos || [])) {
        let texto = "";
        try { texto = await textoDoPdf(pdf); } catch (err) { log("PDF ilegível:", basename(pdf), err.message); continue; }
        const codigos = acharCodigos(texto);
        if (!codigos.length) { const s = boletoSemLinha(texto, pdf); if (s) codigos.push(s); }
        if (!codigos.length) continue;
        const cartPdf = cartorioDoPdf(texto, cart);
        // copia para a pasta da auditoria (nunca sobrescreve)
        const destino = join(ARQUIVO_PDFS, `${e.data.slice(0, 10)}_${e.data.slice(11, 16).replace(":", "")}_${(e.de.split("@")[1] || "cartorio")}_${basename(pdf)}`);
        if (!DRY && existsSync(ARQUIVO_PDFS) && !existsSync(destino)) copyFileSync(pdf, destino);
        const tipo = tipoDe(texto, cartPdf);
        const det = { ...detalhesDe(texto), ref: refDe(texto, e.assunto) };
        const credor = credorDe(texto);
        const pgfn = /FAZENDA NACIONAL|PROCURADORIA GERAL/i.test(credor + " " + (texto.match(/APRESENTANTE\s*:?\s*([A-Z ]{10,60})/i)?.[1] || ""));
        for (const c of codigos) {
          if (!c.venc) c.venc = vencimentoNoTexto(texto);
          const b = { ...c, ...det, tipo, credor, pgfn, cart: cartPdf, de: e.de, assunto: e.assunto, dataEmail: e.data, pdf };
          if (estado.boletos[c.codigo]?.telegram) continue;
          if (c.venc && c.venc < hoje) { vencidos.push(b); continue; }
          doEmail.push(b);
        }
      }
      novos.push(...doEmail);
      if (!doEmail.length) avisos.push({ e, cart, vencidos });
    }

    // ---- boletos: Vobi primeiro (a legenda conta o que foi feito), depois Telegram
    novos.sort((a, b) => String(a.venc).localeCompare(String(b.venc)));
    if (novos.length >= 2) {
      const total = novos.reduce((s, b) => s + b.valor, 0);
      await mandarTexto([
        `📌 <b>${novos.length} boletos de cartório chegaram</b> — vão logo abaixo, um por um:`,
        ...novos.map((b) => `• ${dataBR(b.venc)} — <b>${brl(b.valor)}</b> — ${esc(b.cart.rotulo)} — ${b.pgfn ? "PGFN" : esc(b.credor || (b.ref ? "CDA " + b.ref : b.tipo))}`),
        `Total: <b>${brl(total)}</b>`,
      ].join("\n"));
    }
    for (const b of novos) {
      try { b.vobi = await registrarNaVobi(b); } catch (err) { log("Vobi falhou:", b.codigo, err.message); b.vobi = null; b.erroVobi = err.message; }
      await mandarPdf(b.pdf, legendaDe(b));
      estado.boletos[b.codigo] = {
        telegram: new Date().toISOString(), cartorio: b.cart.rotulo, valor: b.valor, venc: b.venc, tipo: b.tipo,
        credor: b.credor, ref: b.ref, pgfn: b.pgfn, protocolo: b.protocolo, titulo: b.titulo, valorTitulo: b.valorTitulo, custas: b.custas,
        de: b.de, dataEmail: b.dataEmail, vobi: b.vobi || { acao: "pendente", erro: b.erroVobi },
      };
      log("boleto enviado:", b.cart.rotulo, brl(b.valor), b.venc, "| Vobi:", b.vobi?.acao || "pendente");
    }

    // ---- e-mails sem boleto: avisa (fora da 1ª carga) e arquiva
    if (!INICIAL) {
      for (const { e, cart, vencidos } of avisos) {
        const extra = vencidos.length ? `\n⚠️ Veio boleto, mas já vencido em ${[...new Set(vencidos.map((v) => dataBR(v.venc)))].join(", ")} — precisa pedir outro.` : "";
        await mandarTexto(`📨 <b>${esc(cart.rotulo)}</b> respondeu: ${esc(e.assunto)}${extra}\nO e-mail está na pasta <b>${esc(PASTA_OUTLOOK)}</b> do Outlook.`);
      }
    }

    // ---- Vobi que ficou para depois (limite de consultas etc.)
    for (const [codigo, s] of Object.entries(estado.boletos)) {
      if (s.vobi?.acao !== "pendente" || novos.some((b) => b.codigo === codigo)) continue;
      if (s.venc && s.venc < hoje) { s.vobi = { acao: "pulado", txt: "venceu antes de conseguir lançar" }; continue; }
      const cart = CARTORIOS.find((c) => c.rotulo === s.cartorio);
      if (!cart) continue;
      try {
        const r = await registrarNaVobi({ ...s, codigo, cart, especie: codigo.length === 48 ? "guia" : "boleto" });
        s.vobi = r;
        await mandarTexto(`🔁 Vobi atualizada — boleto de <b>${brl(s.valor)}</b> (${esc(s.cartorio)}, vence ${dataBR(s.venc)}): ${r.txt}`);
      } catch (err) { log("Vobi ainda falhando:", codigo, err.message); }
    }

    // ---- arquiva os e-mails e marca como processados
    const aMover = mover.filter((id) => !estado.emails[id]?.movido);
    if (aMover.length && !DRY) {
      const arqIds = join(tmp, "ids.txt");
      writeFileSync(arqIds, aMover.join("\n"), "utf8");
      log(powershell(["-modo", "mover", "-ids", arqIds, "-pastaOutlook", PASTA_OUTLOOK]));
    }
    for (const id of mover) estado.emails[id] = { ...(estado.emails[id] || {}), visto: estado.emails[id]?.visto || new Date().toISOString(), movido: !DRY };
    gravarEstado(estado);
    if (novos.length || avisos.length) log(`passada concluída: ${novos.length} boleto(s), ${avisos.length} e-mail(s) sem boleto, ${aMover.length} arquivado(s)`);
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* temporário */ }
    try { unlinkSync(TRAVA); } catch { /* já saiu */ }
  }
}

main().catch((e) => { log("✖", e?.message || e); process.exit(1); });
