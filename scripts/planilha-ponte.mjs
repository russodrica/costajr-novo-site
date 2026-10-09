#!/usr/bin/env node
/**
 * PONTE DA PLANILHA FINANCEIRA — roda NO COMPUTADOR da Adriana (a cada minuto)
 * ---------------------------------------------------------------------------
 * POR QUE ESTE SCRIPT EXISTE (09/10/2026, opção A da Adriana):
 * A planilha ANALISE_FINANCEIRA_CJR.xlsx era gerada todo dia no GitHub, que
 * parou em 21/09 (franquia de minutos esgotada). A Adriana preferiu gerar só
 * quando pedir — pelo botão do portal ou por /planilha no grupo financeiro do
 * Telegram — e aqui no computador dela, sem GitHub e sem guardar o arquivo em
 * nuvem nossa.
 *
 * O QUE FAZ (uma passada; a tarefa agendada chama de novo a cada minuto)
 *   1. Avisa o site que está viva e pega o próximo pedido pendente
 *      (/api/integra/planilha-jobs). Sem pedido → sai calada.
 *   2. Roda o gerador Python (repositório costajunior-financeiro-diario) com as
 *      credenciais da Vobi do .env daqui.
 *   3. Copia o resultado para a pasta 02_Fluxos (OneDrive → SharePoint) com a
 *      data e a hora no nome — nunca sobrescreve arquivo existente.
 *   4. Manda o arquivo no grupo financeiro do Telegram (direto do computador
 *      para o Telegram: não passa pela Vercel nem pelo Supabase).
 *   5. Fecha o pedido no site (pronto ou erro).
 *
 * COMO USAR
 *   node scripts/planilha-ponte.mjs           (uma passada)
 *   ATIVAR-PLANILHA-AUTOMATICA.cmd            (agenda a cada minuto, sem janela)
 *
 * Configuração opcional no .env:
 *   PLANILHA_GERADOR_DIR  pasta do gerador (padrão: %USERPROFILE%\CJR\gerador-planilha-financeira)
 *   PLANILHA_DESTINO      pasta de destino (padrão: ...\Financeiro\04_Programações de Pagamento\02_Fluxos)
 *   PLANILHA_PYTHON       python.exe (padrão: Python 3.12 do usuário, senão "python")
 */
import { readFileSync, existsSync, statSync, writeFileSync, unlinkSync, copyFileSync, constants as FS } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { tmpdir, homedir, hostname } from "node:os";

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

const SEGREDO = cfg("INTEGRA_TELEGRAM_SECRET");
// O apex redireciona pro www e nem todo cliente segue — usa www direto.
const SITE = cfg("SITE_BASE_URL", "https://www.costajr.com.br")
  .replace(/\/$/, "").replace(/^https?:\/\/costajr\.com\.br$/i, "https://www.costajr.com.br");
const API = `${SITE}/api/integra/planilha-jobs`;
const TOKEN_TG = cfg("TELEGRAM_BOT_TOKEN_ADM");
const CHAT_PADRAO = cfg("TELEGRAM_CHAT_ADM");

const PY_USUARIO = join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "Programs", "Python", "Python312", "python.exe");
const PYTHON = cfg("PLANILHA_PYTHON", existsSync(PY_USUARIO) ? PY_USUARIO : "python");
const GERADOR = cfg("PLANILHA_GERADOR_DIR", join(homedir(), "CJR", "gerador-planilha-financeira"));
const DESTINO = cfg("PLANILHA_DESTINO", "D:\\OneDrive - Costa Jr\\Financeiro\\04_Programações de Pagamento\\02_Fluxos");
const SAIDA = join(GERADOR, "dist", "ANALISE_FINANCEIRA_CJR.xlsx");

const TRAVA = join(tmpdir(), "cjr-planilha-ponte.lock");
const TRAVA_MAX_MS = 25 * 60 * 1000; // gerador demora ~3 min; 25 min = travou
const TEMPO_MAX_MS = 15 * 60 * 1000; // mata o gerador depois disso

const cab = { "x-integra-secret": SEGREDO };
const agoraTxt = () => new Date().toLocaleString("pt-BR");
const log = (...a) => console.log(`[${agoraTxt()}]`, ...a);
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

if (!SEGREDO) {
  console.error("✖ INTEGRA_TELEGRAM_SECRET não encontrado no .env — não dá pra falar com o site.");
  process.exit(1);
}

// ── trava: uma geração por vez (a tarefa roda a cada minuto e a geração leva ~3) ──
function travaOcupada() {
  if (!existsSync(TRAVA)) return false;
  try {
    const idade = Date.now() - statSync(TRAVA).mtimeMs;
    if (idade < TRAVA_MAX_MS) return true;
    unlinkSync(TRAVA); // travada há muito tempo: a geração anterior morreu
  } catch { /* ignora */ }
  return false;
}

async function chamarSite(caminho, opts = {}) {
  const r = await fetch(caminho, { ...opts, headers: { ...cab, ...(opts.headers || {}) } });
  const txt = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} — ${txt.slice(0, 200)}`);
  return JSON.parse(txt);
}

// ── gerador Python ──
function rodarGerador() {
  return new Promise((resolve) => {
    const ultimas = [];
    const guardar = (b) => {
      for (const l of String(b).split(/\r?\n/)) if (l.trim()) { ultimas.push(l); if (ultimas.length > 40) ultimas.shift(); }
    };
    let filho;
    try {
      filho = spawn(PYTHON, ["main.py"], {
        cwd: GERADOR,
        env: { ...process.env, VOBI_UUID: cfg("VOBI_UUID"), VOBI_SECRET: cfg("VOBI_SECRET"), PYTHONIOENCODING: "utf-8" },
        windowsHide: true,
      });
    } catch (e) {
      return resolve({ ok: false, erro: `não consegui iniciar o Python (${PYTHON}): ${e.message}`, ultimas });
    }
    const relogio = setTimeout(() => { try { filho.kill(); } catch {} }, TEMPO_MAX_MS);
    filho.stdout.on("data", guardar);
    filho.stderr.on("data", guardar);
    filho.on("error", (e) => { clearTimeout(relogio); resolve({ ok: false, erro: `Python não iniciou (${PYTHON}): ${e.message}`, ultimas }); });
    filho.on("close", (codigo) => { clearTimeout(relogio); resolve({ ok: codigo === 0, codigo, ultimas }); });
  });
}

// "o que deu errado" em uma linha legível, a partir do fim do log do gerador
function motivoDoErro(res) {
  if (res.erro) return res.erro;
  const linhas = res.ultimas || [];
  const erro = [...linhas].reverse().find((l) => /error|erro|exception|traceback|falh/i.test(l));
  const base = erro || linhas[linhas.length - 1] || `o gerador saiu com código ${res.codigo}`;
  return base.replace(/^\S+ \S+ \| \w+ \| /, "").slice(0, 300);
}

function nomeComData(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `ANALISE_FINANCEIRA_CJR_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.xlsx`;
}

// ── Telegram (direto do computador) ──
async function tg(metodo, corpo) {
  if (!TOKEN_TG) throw new Error("TELEGRAM_BOT_TOKEN_ADM não está no .env");
  const r = await fetch(`https://api.telegram.org/bot${TOKEN_TG}/${metodo}`, { method: "POST", body: corpo });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(`Telegram ${metodo}: ${j.description || r.status}`);
  return j;
}
async function mandarArquivo(chat, caminho, legenda) {
  const fd = new FormData();
  fd.append("chat_id", String(chat));
  fd.append("caption", legenda);
  fd.append("parse_mode", "HTML");
  fd.append("document", new Blob([readFileSync(caminho)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }), basename(caminho));
  return tg("sendDocument", fd);
}
async function mandarTexto(chat, texto) {
  const fd = new FormData();
  fd.append("chat_id", String(chat));
  fd.append("text", texto);
  fd.append("parse_mode", "HTML");
  return tg("sendMessage", fd);
}

async function main() {
  const maquina = encodeURIComponent(hostname());

  // ocupado gerando (outra passada): só avisa que está viva
  if (travaOcupada()) {
    try { await chamarSite(`${API}?ping=1&maquina=${maquina}`); } catch { /* sem rede: tenta no próximo minuto */ }
    return;
  }

  let pedido;
  try {
    ({ pedido } = await chamarSite(`${API}?maquina=${maquina}`));
  } catch (e) {
    log("✖ não consegui falar com o site:", e.message);
    return;
  }
  if (!pedido) return; // nada a fazer — sai calada

  writeFileSync(TRAVA, String(process.pid));
  const chat = pedido.chat_id || CHAT_PADRAO;
  const quem = pedido.solicitante ? `${pedido.solicitante} (${pedido.origem === "telegram" ? "Telegram" : "portal"})` : (pedido.origem === "telegram" ? "Telegram" : "portal");
  log(`▶ pedido ${pedido.id} de ${quem} — gerando em ${GERADOR}`);

  try {
    if (!existsSync(join(GERADOR, "main.py"))) throw new Error(`não achei o gerador em ${GERADOR}`);
    if (!existsSync(DESTINO)) throw new Error(`não achei a pasta de destino ${DESTINO}`);

    const inicio = Date.now();
    const res = await rodarGerador();
    if (!res.ok) throw new Error(motivoDoErro(res));
    if (!existsSync(SAIDA) || statSync(SAIDA).mtimeMs < inicio - 5000 || statSync(SAIDA).size < 100_000) {
      throw new Error("o gerador terminou, mas não deixou uma planilha nova em dist/");
    }

    const nome = nomeComData();
    const final = join(DESTINO, nome);
    copyFileSync(SAIDA, final, FS.COPYFILE_EXCL); // nunca sobrescreve
    const minutos = ((Date.now() - inicio) / 60000).toFixed(1);
    log(`✓ salva em ${final} (${minutos} min)`);

    let enviado = false;
    if (chat) {
      try {
        const hora = new Date().toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
        await mandarArquivo(chat, final,
          `📊 <b>Planilha financeira</b> — dados da Vobi de ${esc(hora)}.\n` +
          `Pedida por ${esc(quem)}. Também está salva na pasta <b>02_Fluxos</b>.`);
        enviado = true;
      } catch (e) {
        log("⚠ planilha salva, mas não consegui mandar no Telegram:", e.message);
      }
    }
    await chamarSite(API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: pedido.id, ok: true, arquivo: nome, telegram: enviado }),
    }).catch((e) => log("⚠ não consegui fechar o pedido no site:", e.message));
  } catch (e) {
    const motivo = String(e?.message || e);
    log("✖ falhou:", motivo);
    if (chat) {
      await mandarTexto(chat,
        `⚠️ <b>Não consegui gerar a planilha financeira</b> pedida por ${esc(quem)}.\n` +
        `Motivo: ${esc(motivo)}\n\nTente de novo com /planilha. Se repetir, me chame no Claude.`,
      ).catch(() => {});
    }
    await chamarSite(API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: pedido.id, ok: false, erro: motivo }),
    }).catch(() => {});
  } finally {
    try { unlinkSync(TRAVA); } catch { /* ignora */ }
  }
}

// a trava só é apagada no finally de quem a criou (aqui não: poderia ser de outra passada)
main().catch((e) => { log("✖ erro inesperado:", e?.message || e); });
