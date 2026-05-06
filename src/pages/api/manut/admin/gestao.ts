import type { APIRoute } from "astro";
import { requireAdmin, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    await requireAdmin(request);
    const db = supabaseAdmin();

    const hoje = new Date();
    const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString();
    const inicioMesPassado = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1).toISOString();
    const fim30d = new Date(hoje.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const [resCli, resCh, resPrev, resOrc] = await Promise.all([
      db.from("manut_clientes")
        .select("id, nome, email, status, plano_selecionado, valor_mensal_contratado, visitas_contratadas, data_proximo_vencimento")
        .order("nome"),
      db.from("manut_chamados")
        .select("id, cliente_id, status, prioridade, data_abertura, tipo")
        .gte("data_abertura", inicioMesPassado),
      db.from("manut_preventivas")
        .select("id, cliente_id, status, data_agendada")
        .gte("data_agendada", inicioMesPassado),
      db.from("manut_orcamentos")
        .select("id, cliente_id, status, created_at, valor")
        .in("status", ["em_analise", "em_ajuste", "proposta_enviada"]),
    ]);

    const clientes = resCli.data || [];
    const chamados = resCh.data || [];
    const preventivas = resPrev.data || [];
    const orcPendentes = resOrc.data || [];

    // Monta score por cliente
    const clientesSaude = clientes.map(c => {
      const chs = chamados.filter(x => x.cliente_id === c.id);
      const chsAbertos = chs.filter(x => ["aberto", "em_andamento", "aguardando_material"].includes(x.status));
      const chsConcluidos = chs.filter(x => x.status === "concluido");
      const chsMesAtual = chs.filter(x => x.data_abertura >= inicioMes);
      const prevMes = preventivas.filter(x => x.cliente_id === c.id && x.data_agendada >= inicioMes);
      const prevRealizadas = preventivas.filter(x => x.cliente_id === c.id && x.status === "realizada");
      const prevProximas = preventivas.filter(x => x.cliente_id === c.id && x.data_agendada >= hoje.toISOString().slice(0,10) && x.data_agendada <= fim30d);
      const orcPend = orcPendentes.filter(x => x.cliente_id === c.id);
      const urgentes = chsAbertos.filter(x => x.prioridade === "urgente");

      // Score de saúde: 100 = perfeito, decresce com problemas
      let score = 100;
      score -= Math.min(chsAbertos.length * 10, 40);  // -10 por chamado aberto, max -40
      score -= urgentes.length * 20;                   // -20 por urgente
      score -= orcPend.length * 5;                     // -5 por orçamento pendente
      if (c.status === "inadimplente") score -= 30;
      score = Math.max(0, score);

      const nivel = score >= 80 ? "verde" : score >= 50 ? "amarelo" : "vermelho";

      return {
        id: c.id,
        nome: c.nome,
        email: c.email,
        status: c.status,
        plano: c.plano_selecionado,
        valor: c.valor_mensal_contratado,
        visitas_contratadas: c.visitas_contratadas,
        data_proximo_vencimento: c.data_proximo_vencimento,
        score,
        nivel,
        ch_abertos: chsAbertos.length,
        ch_concluidos: chsConcluidos.length,
        ch_mes_atual: chsMesAtual.length,
        urgentes: urgentes.length,
        prev_mes: prevMes.length,
        prev_realizadas: prevRealizadas.length,
        prev_proximas: prevProximas.length,
        orc_pendentes: orcPend.length,
      };
    });

    // Totais globais
    const ativos = clientes.filter(c => c.status === "ativo");
    const receita = ativos.reduce((s, c) => s + Number(c.valor_mensal_contratado || 0), 0);
    const totalAbertos = chamados.filter(x => ["aberto", "em_andamento", "aguardando_material"].includes(x.status)).length;
    const emRisco = clientesSaude.filter(c => c.nivel === "vermelho").length;
    const atencao = clientesSaude.filter(c => c.nivel === "amarelo").length;
    const saudaveis = clientesSaude.filter(c => c.nivel === "verde").length;
    const prevProx30d = preventivas.filter(x => x.data_agendada >= hoje.toISOString().slice(0,10) && x.data_agendada <= fim30d).length;

    // Tendência de chamados — últimas 8 semanas
    const tendencia = Array.from({ length: 8 }, (_, i) => {
      const fimSem = new Date(hoje);
      fimSem.setDate(fimSem.getDate() - i * 7);
      const iniSem = new Date(fimSem);
      iniSem.setDate(iniSem.getDate() - 7);
      const count = chamados.filter(c => {
        const d = new Date(c.data_abertura);
        return d >= iniSem && d < fimSem;
      }).length;
      const label = `${iniSem.getDate()}/${iniSem.getMonth() + 1}`;
      return { label, count };
    }).reverse();

    return jsonOk({
      totais: { ativos: ativos.length, receita, totalAbertos, emRisco, atencao, saudaveis, prevProx30d, orcPendentes: orcPendentes.length },
      tendencia,
      clientes: clientesSaude,
    });
  } catch (e: any) {
    return jsonErr(e.message === "Não autorizado" ? 401 : 500, e.message);
  }
};
