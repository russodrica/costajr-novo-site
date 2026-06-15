import type { APIRoute } from "astro";
import { enviarTelegram, escTg } from "~/lib/telegram";
import { rhidConfigurado, agoraSP, montarDia, relatorioSaida, auditarLocais, diagnostico } from "~/lib/rhid";

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
    try { return J({ ok: true, diag: await diagnostico(dataISO) }); }
    catch (e: any) { return J({ ok: false, error: String(e?.message || e) }, 502); }
  }

  if (ag.diaSemana === 0 && url.searchParams.get("force") !== "1") {
    return J({ ok: true, skip: "domingo" });
  }

  try {
    const d = await montarDia(dataISO);
    const { bateuSaida, semSaida } = relatorioSaida(d);
    const anomalias = url.searchParams.get("semAuditoria") === "1" ? [] : auditarLocais(d);

    const resumo = {
      data: dataISO,
      ativos: d.pessoasAtivas.length,
      bateuSaida: bateuSaida.length,
      semSaida: semSaida.length,
      semSaidaNomes: semSaida.map((x) => x.p.nome),
      anomaliasLocal: anomalias.map((a) => ({ nome: a.p.nome, locais: a.locais.map((l) => l.nome) })),
    };

    if (url.searchParams.get("dry") === "1") return J({ ok: true, dry: true, resumo });

    // Mensagem principal de saída — sempre enviada (é um resumo do fim do dia).
    const blocoSaida =
      `🌙 <b>Ponto — Saída (${dia(dataISO)})</b>\n` +
      `✅ Bateram a saída: <b>${bateuSaida.length}</b>\n` +
      (semSaida.length
        ? `⚠️ Ainda SEM saída (${semSaida.length}):\n${listaNomes(semSaida.map((x) => `${x.p.nome} (entrou ${x.desde})`))}`
        : `👍 Ninguém em aberto — todos que entraram já bateram a saída.`) +
      `\n\n<i>${d.pessoasAtivas.length} ativos</i>`;

    const r1 = await enviarTelegram(blocoSaida, { canal: "ATIVOS" });

    // Auditoria de local — só alerta quando há batidas em locais diferentes.
    let auditoriaEnviada = false;
    if (anomalias.length) {
      const linhas = anomalias
        .slice()
        .sort((a, b) => a.p.nome.localeCompare(b.p.nome, "pt-BR"))
        .map((a) => `• <b>${escTg(a.p.nome)}</b>: ` + a.locais.map((l) => `${escTg(l.nome)} (${escTg(l.horas.join(", "))})`).join(" ↔ "))
        .join("\n");
      const blocoAud =
        `📍 <b>Auditoria de local — ${dia(dataISO)}</b>\n` +
        `Batidas em locais/equipamentos diferentes no mesmo dia:\n${linhas}`;
      const r2 = await enviarTelegram(blocoAud, { canal: "ATIVOS" });
      auditoriaEnviada = r2.ok;
    }

    return J({ ok: r1.ok, enviado: r1.ok, auditoriaEnviada, anomalias: anomalias.length, motivo: r1.motivo, resumo }, r1.ok ? 200 : 502);
  } catch (e: any) {
    return J({ ok: false, error: String(e?.message || e) }, 502);
  }
}

export const GET: APIRoute = ({ request, url }) => handle(request, url);
export const POST: APIRoute = ({ request, url }) => handle(request, url);
