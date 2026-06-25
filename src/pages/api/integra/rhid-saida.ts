import type { APIRoute } from "astro";
import { enviarTelegram, escTg } from "~/lib/telegram";
import { rhidConfigurado, agoraSP, montarDia, resumoJornada, diagnostico, probeAfdMobile } from "~/lib/rhid";

export const prerender = false;

// GET/POST /api/integra/rhid-saida
// Resumo de SAÍDA (rodar ~18h, seg-sáb): mostra os DOIS lados — quem já bateu a
// saída e quem ainda está em aberto (entrou e não bateu saída) — e roda a
// AUDITORIA DE LOCAL (quem bateu ponto em equipamentos/locais diferentes no dia).
// Envia ao Telegram do grupo CJR Ativos.
//
// Mesma proteção/parametros do rhid-entrada:
//   header x-integra-secret / ?key=<INTEGRA_TELEGRAM_SECRET>  (ou Bearer CRON_SECRET)
//   ?diag=1  ?dry=1  ?force=1  ?data=YYYY-MM-DD
// Extra: ?semAuditoria=1 desliga o bloco de auditoria.

const SECRET = (import.meta.env.INTEGRA_TELEGRAM_SECRET || process.env.INTEGRA_TELEGRAM_SECRET || "") as string;
const CRON_SECRET = (import.meta.env.CRON_SECRET || process.env.CRON_SECRET || "") as string;

function autorizado(request: Request, url: URL): boolean {
  const auth = request.headers.get("authorization") || "";
  if (CRON_SECRET && auth === `Bearer ${CRON_SECRET}`) return true;
  if (!SECRET) return false;
  const chave = request.headers.get("x-integra-secret") || url.searchParams.get("key") || "";
  return chave === SECRET;
}

// Lista nomes com um teto (evita mensagem gigante).
function listaNomes(itens: string[], teto = 30): string {
  const ord = itens.slice().sort((a, b) => a.localeCompare(b, "pt-BR"));
  if (ord.length <= teto) return ord.map((n) => `• ${escTg(n)}`).join("\n");
  return ord.slice(0, teto).map((n) => `• ${escTg(n)}`).join("\n") + `\n• <i>… +${ord.length - teto}</i>`;
}

async function handle(request: Request, url: URL): Promise<Response> {
  const J = (o: any, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });

  if (!SECRET && !CRON_SECRET) return J({ ok: false, error: "INTEGRA_TELEGRAM_SECRET não configurado" }, 503);
  if (!autorizado(request, url)) return J({ ok: false, error: "não autorizado" }, 401);
  if (!rhidConfigurado()) return J({ ok: false, error: "Credenciais do RHiD ausentes (RHID_EMAIL/RHID_SENHA)" }, 503);

  const ag = agoraSP();
  const dataISO = url.searchParams.get("data") || ag.iso;
  const dia = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

  if (url.searchParams.get("diag") === "1") {
    try { return J({ ok: true, diag: await diagnostico(dataISO, url.searchParams.get("nome") || undefined) }); }
    catch (e: any) { return J({ ok: false, error: String(e?.message || e) }, 502); }
  }
  if (url.searchParams.get("afdmobile") === "1") {
    const di = url.searchParams.get("di") || dataISO;
    const df = url.searchParams.get("df") || dataISO;
    try { return J({ ok: true, afdmobile: await probeAfdMobile(di, df) }); }
    catch (e: any) { return J({ ok: false, error: String(e?.message || e) }, 502); }
  }

  if (ag.diaSemana === 0 && url.searchParams.get("force") !== "1") {
    return J({ ok: true, skip: "domingo" });
  }

  try {
    const d = await montarDia(dataISO);
    const dias = d.dias.slice().sort((a, b) => a.pessoa.nome.localeCompare(b.pessoa.nome, "pt-BR"));

    // Bloco de cada colaborador: entrada · almoço · saída.
    const blocos = dias.map((x) => {
      const nome = `👤 <b>${escTg(x.pessoa.nome)}</b>`;
      if (!x.trabalhaHoje) return `${nome}\n   <i>sem expediente hoje</i>`;
      const j = resumoJornada(x.punches);
      if (j.nBatidas === 0) return `${nome}\n   🔴 não bateu o ponto hoje`;
      const almoco = j.almocoIni && j.almocoFim ? `${j.almocoIni}–${j.almocoFim}` : "—";
      const saida = j.saida ? `${j.saida} ✅` : "⏳ pendente ⚠️";
      return `${nome}\n   Entrada ${j.entrada || "—"} · Almoço ${almoco} · Saída ${saida}`;
    });

    const resumo = {
      data: dataISO,
      ativos: dias.length,
      emAberto: dias.filter((x) => x.trabalhaHoje && resumoJornada(x.punches).emAberto).length,
      pessoas: dias.map((x) => ({ nome: x.pessoa.nome, ...resumoJornada(x.punches), trabalhaHoje: x.trabalhaHoje })),
    };

    if (url.searchParams.get("dry") === "1") return J({ ok: true, dry: true, resumo });

    const msg =
      `🌙 <b>Ponto — Resumo do dia</b> · ${dia(dataISO)}\n\n` +
      blocos.join("\n\n");

    const r = await enviarTelegram(msg, { canal: "ATIVOS" });
    return J({ ok: r.ok, enviado: r.ok, motivo: r.motivo, resumo }, r.ok ? 200 : 502);
  } catch (e: any) {
    return J({ ok: false, error: String(e?.message || e) }, 502);
  }
}

export const GET: APIRoute = ({ request, url }) => handle(request, url);
export const POST: APIRoute = ({ request, url }) => handle(request, url);
