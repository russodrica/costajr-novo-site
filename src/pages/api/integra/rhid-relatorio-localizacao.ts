import type { APIRoute } from "astro";
import { rhidConfigurado, buscarMarcacoesMobile } from "~/lib/rhid";
import { baixarMapa } from "~/lib/mapaEstatico";
import { gerarRelatorioLocalizacaoPdf, type PessoaPdf } from "~/lib/relatorioLocalizacaoPdf";
import { enviarEmailComAnexo } from "~/lib/mailer";

export const prerender = false;

// GET/POST /api/integra/rhid-relatorio-localizacao
// Gera o relatório MENSAL de localização das marcações REP-P (app) — PDF com
// mapa por colaborador — e envia para rh@costajr.com.br.
// Acionado 1x/mês por gatilho externo (GitHub Actions). Protegido pelo segredo.
//   ?mes=YYYY-MM   -> mês de referência (default: mês anterior)
//   ?to=email      -> destinatário (default: rh@costajr.com.br)
//   ?dry=1         -> calcula e devolve resumo, NÃO envia e-mail

const SECRET = (import.meta.env.INTEGRA_TELEGRAM_SECRET || process.env.INTEGRA_TELEGRAM_SECRET || "") as string;
const CRON_SECRET = (import.meta.env.CRON_SECRET || process.env.CRON_SECRET || "") as string;
const SITE = (import.meta.env.SITE_BASE_URL || "https://costajr.com.br") as string;
const RH_EMAIL = (import.meta.env.RH_ALERT_EMAIL || "rh@costajr.com.br") as string;

function autorizado(request: Request, url: URL): boolean {
  const auth = request.headers.get("authorization") || "";
  if (CRON_SECRET && auth === `Bearer ${CRON_SECRET}`) return true;
  if (!SECRET) return false;
  return (request.headers.get("x-integra-secret") || url.searchParams.get("key") || "") === SECRET;
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

// mês anterior (no fuso de São Paulo) no formato YYYY-MM
function mesAnterior(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" });
  const p = Object.fromEntries(fmt.formatToParts(new Date()).map((x) => [x.type, x.value]));
  let y = Number(p.year), m = Number(p.month) - 1;
  if (m < 1) { m = 12; y -= 1; }
  return `${y}-${String(m).padStart(2, "0")}`;
}

// executa fn em lotes (concorrência limitada)
async function emLotes<T, R>(itens: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < itens.length; i += n) out.push(...(await Promise.all(itens.slice(i, i + n).map(fn))));
  return out;
}

async function handle(request: Request, url: URL): Promise<Response> {
  const J = (o: any, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
  if (!SECRET && !CRON_SECRET) return J({ ok: false, error: "INTEGRA_TELEGRAM_SECRET não configurado" }, 503);
  if (!autorizado(request, url)) return J({ ok: false, error: "não autorizado" }, 401);
  if (!rhidConfigurado()) return J({ ok: false, error: "Credenciais do RHiD ausentes" }, 503);

  const mes = url.searchParams.get("mes") || mesAnterior(); // YYYY-MM
  const m = mes.match(/^(\d{4})-(\d{2})$/);
  if (!m) return J({ ok: false, error: "mes inválido (use YYYY-MM)" }, 400);
  const [, ys, ms] = m;
  const dataIni = `${ys}-${ms}-01`;
  const ultimoDia = new Date(Date.UTC(Number(ys), Number(ms), 0)).getUTCDate();
  const dataFinal = `${ys}-${ms}-${String(ultimoDia).padStart(2, "0")}`;
  const mesLabel = `${MESES[Number(ms) - 1]}/${ys}`;
  const to = url.searchParams.get("to") || RH_EMAIL;

  try {
    const pessoas = await buscarMarcacoesMobile(dataIni, dataFinal);
    const batidas = pessoas.reduce((s, p) => s + p.marcacoes.length, 0);
    const gpsDesligado = pessoas.reduce((s, p) => s + p.marcacoes.filter((x) => x.gpsDesligado).length, 0);
    const resumo = { mes, pessoas: pessoas.length, batidas, gpsDesligado };

    if (url.searchParams.get("dry") === "1") {
      return J({ ok: true, dry: true, periodo: { dataIni, dataFinal }, resumo, amostraPessoas: pessoas.slice(0, 5).map((p) => ({ nome: p.nome, batidas: p.marcacoes.length })) });
    }
    if (!batidas) return J({ ok: true, enviado: false, motivo: "sem marcações no mês", resumo });

    // mapas (1 por pessoa, em lotes p/ não sobrecarregar o provedor)
    const mapas = await emLotes(pessoas, 6, (p) => baixarMapa(p.marcacoes.map((x) => ({ lat: x.lat, lng: x.lng }))));

    // logo p/ a capa (best-effort)
    let logoBytes: Uint8Array | null = null;
    try { const r = await fetch(`${SITE}/logo-cjr.png`); if (r.ok) logoBytes = new Uint8Array(await r.arrayBuffer()); } catch { /* ok */ }

    const pessoasPdf: PessoaPdf[] = pessoas.map((p, i) => ({ nome: p.nome, marcacoes: p.marcacoes, mapaBytes: mapas[i] }));
    const geradoEm = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const pdf = await gerarRelatorioLocalizacaoPdf({
      mesLabel, empresa: "Costa Júnior Engenharia e Construções Ltda", geradoEm,
      resumo: { pessoas: pessoas.length, batidas, gpsDesligado }, pessoas: pessoasPdf, logoBytes,
    });

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:28px 24px">
        <h2 style="color:#C41E3A;margin:0 0 6px">Relatório de localização de ponto</h2>
        <p style="color:#5B5F6B;margin:0 0 18px">Marcações via aplicativo (REP-P) — <strong>${mesLabel}</strong>. Segue o PDF em anexo, com o mapa das batidas por colaborador.</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr><td style="padding:6px 0;color:#9CA3AF">Colaboradores</td><td style="padding:6px 0;color:#2D2F36;font-weight:600">${pessoas.length}</td></tr>
          <tr><td style="padding:6px 0;color:#9CA3AF">Batidas no mês</td><td style="padding:6px 0;color:#2D2F36;font-weight:600">${batidas}</td></tr>
          <tr><td style="padding:6px 0;color:#9CA3AF">Com GPS desligado</td><td style="padding:6px 0;font-weight:700;color:${gpsDesligado ? "#C41E3A" : "#2D2F36"}">${gpsDesligado}</td></tr>
        </table>
        <p style="color:#9CA3AF;font-size:12px;margin-top:22px">As batidas feitas com GPS desligado (sem localização) estão destacadas no PDF. Costa Júnior — Engenharia e Construções Ltda</p>
      </div>`;

    await enviarEmailComAnexo({
      to, subject: `Relatório de localização de ponto — ${mesLabel}`, html,
      anexos: [{ filename: `localizacao-ponto-${mes}.pdf`, content: pdf }],
    });
    return J({ ok: true, enviado: true, para: to, resumo, pdfKb: Math.round(pdf.length / 1024) });
  } catch (e: any) {
    return J({ ok: false, error: String(e?.message || e) }, 502);
  }
}

export const GET: APIRoute = ({ request, url }) => handle(request, url);
export const POST: APIRoute = ({ request, url }) => handle(request, url);
