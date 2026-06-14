import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { gerarCupomRenovacao } from "~/lib/manut/clientes";
import { enviarEmailCupomRenovacao } from "~/lib/mailer";
import { enviarDigestVencimentosRh, enviarAniversariantesDoMes } from "~/lib/rhVencimentos";
import { enviarLembretesFerias, garantirPeriodoAtual } from "~/lib/ferias";
import { expurgarLixeira } from "~/lib/auditoria";
import { enviarAlertasEpi } from "~/lib/epi";
import { enviarLembreteAvaliacoes } from "~/lib/avaliacoes";
import { enviarLembreteClima } from "~/lib/clima";

export const prerender = false;

// Cron diário (Vercel: configurado em vercel.json — 09:00 UTC).
// Gera cupom de renovação para clientes ativos cujo plano vence em 10 dias
// (janela 9-11 dias para tolerar atrasos), com saldo de cashback > 0.
// Cada cliente recebe no máximo 1 cupom de renovação no ciclo (controle via
// existência de cupom CASH-* gerado nos últimos 12 dias).
export const GET: APIRoute = async ({ request, url }) => {
  // Autorização: aceita header padrão da Vercel para cron, ou querystring secret
  const auth = request.headers.get("authorization") || "";
  const cronSecret = import.meta.env.CRON_SECRET || "";
  const qsSecret = url.searchParams.get("secret") || "";
  const vercelCron = auth === `Bearer ${cronSecret}`;
  const manual = cronSecret && qsSecret === cronSecret;
  if (cronSecret && !vercelCron && !manual) {
    return new Response("Forbidden", { status: 403 });
  }

  const db = supabaseAdmin();
  const hoje = new Date();
  const fim = new Date(Date.now() + 11 * 24 * 60 * 60 * 1000); // até 11 dias
  const inicio = new Date(Date.now() + 9 * 24 * 60 * 60 * 1000); // a partir de 9 dias

  const { data: clientes } = await db
    .from("manut_clientes")
    .select("id,nome,email,saldo_cashback,data_proximo_vencimento")
    .eq("status", "ativo")
    .gt("saldo_cashback", 0)
    .gte("data_proximo_vencimento", inicio.toISOString())
    .lte("data_proximo_vencimento", fim.toISOString());

  const resultados: any[] = [];
  for (const c of clientes || []) {
    try {
      // Evita gerar cupom duplicado: checa se já existe CASH- recente do cliente
      const corte = new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString();
      const { data: jaTem } = await db
        .from("manut_cupons")
        .select("codigo,created_at")
        .eq("cliente_dono_id", c.id)
        .like("codigo", "CASH-%")
        .gte("created_at", corte)
        .limit(1)
        .maybeSingle();
      if (jaTem) {
        resultados.push({ id: c.id, status: "ja_gerado", codigo: jaTem.codigo });
        continue;
      }

      const r = await gerarCupomRenovacao(c.id);
      const diasParaVencer = Math.max(
        1,
        Math.round((new Date(c.data_proximo_vencimento).getTime() - hoje.getTime()) / (24 * 60 * 60 * 1000))
      );

      if (c.email) {
        try {
          await enviarEmailCupomRenovacao({
            clienteEmail: c.email,
            clienteNome: c.nome || "Cliente",
            codigoCupom: r.cupom.codigo,
            valorCashback: r.valorConvertido,
            descontoPct: r.descontoPct,
            diasParaVencer,
          });
        } catch (e: any) {
          console.warn("[cron][cashback] email falhou:", e?.message);
        }
      }

      resultados.push({ id: c.id, status: "gerado", codigo: r.cupom.codigo, valor: r.valorConvertido });
    } catch (e: any) {
      resultados.push({ id: c.id, status: "erro", erro: e?.message });
    }
  }

  // ── Piggyback: alertas de vencimento de documentos de RH (30/15/7 dias + no dia) ──
  // Roda junto deste cron diário para não consumir um novo slot de cron na Vercel.
  let rhDigest: any = { total: 0, enviados: 0 };
  try {
    rhDigest = await enviarDigestVencimentosRh(db, { modo: "marcos" });
  } catch (e: any) {
    console.warn("[cron][rh-vencimentos] falhou:", e?.message);
  }

  // ── Piggyback: auto-avanço do período aquisitivo (cria o do ciclo vigente) ──
  try {
    const adv = await garantirPeriodoAtual(db);
    if (adv.criados) console.log(`[cron][ferias] ${adv.criados} período(s) do ciclo atual criado(s)`);
  } catch (e: any) {
    console.warn("[cron][ferias-avanco] falhou:", e?.message);
  }

  // ── Piggyback: lembretes de programação de férias (6/3/1 mês, semanal, 30/15/7, dar OK) ──
  let feriasDigest: any = { eventos: 0, enviados: 0 };
  try {
    feriasDigest = await enviarLembretesFerias(db);
  } catch (e: any) {
    console.warn("[cron][ferias] falhou:", e?.message);
  }

  // ── Piggyback: expurgo da lixeira (itens com mais de 30 dias) ──
  let lixeira: any = { removidos: 0 };
  try {
    lixeira = await expurgarLixeira(db);
  } catch (e: any) {
    console.warn("[cron][lixeira] falhou:", e?.message);
  }

  // ── Piggyback: alertas de EPI a vencer (15 dias) → rh@ + engenharia@ ──
  let epi: any = { total: 0, enviados: 0 };
  try {
    epi = await enviarAlertasEpi(db);
  } catch (e: any) {
    console.warn("[cron][epi] falhou:", e?.message);
  }

  // ── Piggyback: aniversariantes do mês + lembrete de avaliação — só no dia 1 ──
  let aniversariantes: any = { total: 0, enviados: 0 };
  let avaliacoes: any = { disparou: false };
  let clima: any = { enviados: 0 };
  if (new Date().getUTCDate() === 1) {
    try {
      aniversariantes = await enviarAniversariantesDoMes(db);
    } catch (e: any) {
      console.warn("[cron][aniversariantes] falhou:", e?.message);
    }
    try {
      avaliacoes = await enviarLembreteAvaliacoes(db); // só dispara em Mar/Jun/Set/Dez
    } catch (e: any) {
      console.warn("[cron][avaliacoes] falhou:", e?.message);
    }
    try {
      clima = await enviarLembreteClima(db); // só dispara em Mar/Jun/Set/Dez (1º dia)
    } catch (e: any) {
      console.warn("[cron][clima] falhou:", e?.message);
    }
  }

  return new Response(JSON.stringify({ ok: true, processados: resultados.length, resultados, rh_vencimentos: rhDigest, ferias: feriasDigest, lixeira, aniversariantes, epi, avaliacoes, clima }), {
    headers: { "content-type": "application/json" },
  });
};
