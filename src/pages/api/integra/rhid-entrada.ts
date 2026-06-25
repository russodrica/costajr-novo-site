import type { APIRoute } from "astro";
import { enviarTelegram, escTg } from "~/lib/telegram";
import { rhidConfigurado, agoraSP, montarDia, resumoJornada, diagnostico } from "~/lib/rhid";

export const prerender = false;

// GET/POST /api/integra/rhid-entrada
// Alerta de ENTRADA (rodar ~10h, seg-sáb): lista os colaboradores ativos que
// ainda NÃO bateram nenhum ponto no dia. Envia ao Telegram do grupo CJR Ativos.
//
// Acionado por gatilho externo (Power Automate / cron-job.org), pois a Vercel
// Hobby já usa os 2 slots de cron. Protegido pelo mesmo segredo das integrações:
//   header  x-integra-secret: <segredo>   ou   ?key=<segredo>   (INTEGRA_TELEGRAM_SECRET)
//   (também aceita  Authorization: Bearer <CRON_SECRET>)
// Parâmetros:
//   ?diag=1   -> testa conexão com o RHiD e devolve um resumo (não envia Telegram)
//   ?dry=1    -> calcula e devolve JSON, mas NÃO envia ao Telegram
//   ?force=1  -> ignora a trava de domingo
//   ?data=YYYY-MM-DD -> força a data (default: hoje em São Paulo)

const SECRET = (import.meta.env.INTEGRA_TELEGRAM_SECRET || process.env.INTEGRA_TELEGRAM_SECRET || "") as string;
const CRON_SECRET = (import.meta.env.CRON_SECRET || process.env.CRON_SECRET || "") as string;

function autorizado(request: Request, url: URL): boolean {
  const auth = request.headers.get("authorization") || "";
  if (CRON_SECRET && auth === `Bearer ${CRON_SECRET}`) return true;
  if (!SECRET) return false;
  const chave = request.headers.get("x-integra-secret") || url.searchParams.get("key") || "";
  return chave === SECRET;
}

async function handle(request: Request, url: URL): Promise<Response> {
  const J = (o: any, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });

  if (!SECRET && !CRON_SECRET) return J({ ok: false, error: "INTEGRA_TELEGRAM_SECRET não configurado" }, 503);
  if (!autorizado(request, url)) return J({ ok: false, error: "não autorizado" }, 401);
  if (!rhidConfigurado()) return J({ ok: false, error: "Credenciais do RHiD ausentes (RHID_EMAIL/RHID_SENHA)" }, 503);

  const ag = agoraSP();
  const dataISO = url.searchParams.get("data") || ag.iso;
  const dia = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

  // diagnóstico de conexão
  if (url.searchParams.get("diag") === "1") {
    try { return J({ ok: true, diag: await diagnostico(dataISO) }); }
    catch (e: any) { return J({ ok: false, error: String(e?.message || e) }, 502); }
  }

  // trava de domingo (seg-sáb)
  if (ag.diaSemana === 0 && url.searchParams.get("force") !== "1") {
    return J({ ok: true, skip: "domingo" });
  }

  try {
    const d = await montarDia(dataISO);
    const dias = d.dias.slice().sort((a, b) => a.pessoa.nome.localeCompare(b.pessoa.nome, "pt-BR"));

    // uma linha por colaborador ativo
    const linhas = dias.map((x) => {
      if (!x.trabalhaHoje) return `⚪ ${escTg(x.pessoa.nome)} — sem expediente hoje`;
      const ent = resumoJornada(x.punches).entrada;
      return ent ? `🟢 ${escTg(x.pessoa.nome)} — entrou ${ent}` : `🔴 ${escTg(x.pessoa.nome)} — <b>sem entrada</b>`;
    });
    const semEntrada = dias.filter((x) => x.trabalhaHoje && x.punches.length === 0);

    const resumo = {
      data: dataISO,
      ativos: dias.length,
      semEntrada: semEntrada.length,
      pessoas: dias.map((x) => ({ nome: x.pessoa.nome, trabalhaHoje: x.trabalhaHoje, entrada: resumoJornada(x.punches).entrada })),
    };

    if (url.searchParams.get("dry") === "1") return J({ ok: true, dry: true, resumo });

    // Só dispara o alerta quando alguém com expediente ainda não bateu a entrada.
    if (semEntrada.length === 0) {
      return J({ ok: true, enviado: false, motivo: "todos com expediente já bateram entrada", resumo });
    }

    const msg =
      `⏰ <b>Ponto — Entrada</b> · ${dia(dataISO)} (situação às ${String(ag.hora).padStart(2, "0")}h)\n\n` +
      linhas.join("\n");

    const r = await enviarTelegram(msg, { canal: "ATIVOS" });
    return J({ ok: r.ok, enviado: r.ok, motivo: r.motivo, resumo }, r.ok ? 200 : 502);
  } catch (e: any) {
    return J({ ok: false, error: String(e?.message || e) }, 502);
  }
}

export const GET: APIRoute = ({ request, url }) => handle(request, url);
export const POST: APIRoute = ({ request, url }) => handle(request, url);
