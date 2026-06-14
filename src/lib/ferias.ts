import { enviarEmailSimples } from "./mailer";

// ════════════════════════════════════════════════════════════════════════
// Programação de Férias (CLT).
//   Período aquisitivo = 12 meses trabalhados → 30 dias de direito.
//   Pode ser parcelado em até 3 partes (ex.: 10/10/10).
//   Verde quando soma das parcelas = 30; vermelho quando falta programar.
//   Lembretes: 6/3/1 mês do vencimento (limite concessivo) se não programado;
//   nag semanal se aberto; 30/15/7 dias antes de cada parcela; "dar OK" ao
//   passar a parcela. Ao confirmar os 30 dias, o período conclui e o próximo
//   é liberado. Destinatários: rh@ + adriana@.
// ════════════════════════════════════════════════════════════════════════

const SITE = import.meta.env.SITE_BASE_URL || "https://costajr.com.br";
export const RH_ALERT_EMAIL = import.meta.env.RH_ALERT_EMAIL || "rh@costajr.com.br, adriana@costajr.com.br";
export const DIAS_DIREITO = 30;
export const MAX_PARCELAS = 3;
export const MIN_DIAS_PARCELA = 5; // mínimo por parcela (regra CLT)

// ── Datas (UTC, sem fuso) ───────────────────────────────────────────────
export const hojeISO = () => new Date().toISOString().slice(0, 10);
export function addDays(iso: string, n: number): string {
  return new Date(new Date(iso + "T00:00:00Z").getTime() + n * 86400000).toISOString().slice(0, 10);
}
export function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1 + n, 1));
  const ultimoDia = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(d, ultimoDia));
  return base.toISOString().slice(0, 10);
}
export function diffDias(alvo: string, ref = hojeISO()): number {
  return Math.round((new Date(alvo + "T00:00:00Z").getTime() - new Date(ref + "T00:00:00Z").getTime()) / 86400000);
}
export const fmtBR = (iso: string) => (iso ? iso.split("-").reverse().join("/") : "—");

// ── Cálculo do período aquisitivo a partir da admissão ──────────────────
// ciclo 0 = primeiro período (12 meses após a admissão).
export function calcularPeriodo(dataAdmissao: string, ciclo: number) {
  const inicio_aquisitivo = addMonths(dataAdmissao, ciclo * 12);
  const fim_aquisitivo = addDays(addMonths(inicio_aquisitivo, 12), -1);
  const limite_concessivo = addMonths(fim_aquisitivo, 12); // prazo legal p/ conceder
  return { inicio_aquisitivo, fim_aquisitivo, limite_concessivo, dias_direito: DIAS_DIREITO };
}

// Quantos ciclos já completaram 12 meses desde a admissão (até hoje).
export function ciclosVencidos(dataAdmissao: string): number {
  if (!dataAdmissao) return 0;
  let ciclo = 0;
  while (diffDias(addMonths(dataAdmissao, (ciclo + 1) * 12)) <= 0) ciclo++;
  return ciclo; // nº de períodos aquisitivos já COMPLETADOS
}

// ── Resumo de completude de um período ──────────────────────────────────
export type Parcela = { id: string; data_inicio: string; dias: number; data_fim: string; status: string; aviso_pos?: boolean };
export function resumoPeriodo(dias_direito: number, parcelas: Parcela[], dias_abono = 0) {
  const abono = Math.max(0, Math.min(dias_direito, dias_abono || 0));
  // dias vendidos (abono) reduzem o descanso a programar
  const aDescansar = Math.max(0, dias_direito - abono);
  const somaProgramada = parcelas.reduce((s, p) => s + (p.dias || 0), 0);
  const somaConfirmada = parcelas.filter((p) => p.status === "confirmada").reduce((s, p) => s + (p.dias || 0), 0);
  const completo = somaProgramada + abono >= dias_direito;
  const tudoConfirmado = somaConfirmada + abono >= dias_direito;
  return {
    somaProgramada, somaConfirmada, completo, tudoConfirmado, abono, aDescansar,
    faltam: Math.max(0, aDescansar - somaProgramada),
    restanteParaProgramar: Math.max(0, aDescansar - somaProgramada),
  };
}

// ════════════════════════════════════════════════════════════════════════
// Auto-avanço: garante que todo CLT/PJ ativo tenha o período aquisitivo do
// CICLO VIGENTE (o que precisa ser programado neste ano). Quando o colaborador
// completa mais um ano (novo período aquisitivo nasce), este cria o período do
// novo ciclo automaticamente — sem precisar clicar em "Gerar períodos".
// Idempotente: pula quem já tem o período do ciclo atual. Chamado pelo cron.
// ════════════════════════════════════════════════════════════════════════
export async function garantirPeriodoAtual(db: any): Promise<{ criados: number }> {
  const { data: colabs } = await db.from("rh_colaboradores")
    .select("id, data_admissao, regime, status").in("regime", ["clt", "pj"]).neq("status", "desligado").neq("status", "congelado").limit(3000);
  const { data: existentes } = await db.from("rh_ferias_periodos").select("colaborador_id, inicio_aquisitivo").limit(8000);
  const jaTem = new Set((existentes || []).map((e: any) => `${e.colaborador_id}|${e.inicio_aquisitivo}`));
  const novos: any[] = [];
  for (const c of colabs || []) {
    if (!c.data_admissao) continue;
    const ciclo = Math.max(0, ciclosVencidos(c.data_admissao) - 1); // período vigente a programar
    const per = calcularPeriodo(c.data_admissao, ciclo);
    if (jaTem.has(`${c.id}|${per.inicio_aquisitivo}`)) continue;
    novos.push({ colaborador_id: c.id, ...per, status: "aberto" });
  }
  let criados = 0;
  for (let i = 0; i < novos.length; i += 200) {
    const { data } = await db.from("rh_ferias_periodos").insert(novos.slice(i, i + 200)).select("id");
    criados += data?.length || 0;
  }
  return { criados };
}

// ════════════════════════════════════════════════════════════════════════
// Lembretes por e-mail (chamado pelo cron diário). Junta todos os eventos
// do dia em UM digest e só grava as flags se o e-mail for enviado.
// ════════════════════════════════════════════════════════════════════════
type Evento = { tipo: string; colaborador: string; texto: string; cor: string };

export async function enviarLembretesFerias(db: any, opts: { dry?: boolean; para?: string } = {}) {
  const para = opts.para || RH_ALERT_EMAIL;
  const hoje = hojeISO();

  // períodos abertos de colaboradores CLT ativos
  const { data: periodos } = await db
    .from("rh_ferias_periodos")
    .select("*, rh_colaboradores(nome, regime, status)")
    .neq("status", "concluido")
    .limit(2000);

  const lista = (periodos || []).filter((p: any) => {
    const c = p.rh_colaboradores;
    // status "congelado" (jurídico — litígio/acordo) pausa os lembretes de férias
    return c && (c.regime === "clt" || c.regime === "pj") && c.status !== "desligado" && c.status !== "congelado";
  });
  if (!lista.length) return { eventos: 0, enviados: 0 };

  const ids = lista.map((p: any) => p.id);
  const { data: todasParcelas } = await db.from("rh_ferias_parcelas").select("*").in("periodo_id", ids).limit(6000);
  const parcelasPorPeriodo: Record<string, any[]> = {};
  for (const pc of todasParcelas || []) (parcelasPorPeriodo[pc.periodo_id] = parcelasPorPeriodo[pc.periodo_id] || []).push(pc);

  const eventos: Evento[] = [];
  const updPeriodo: { id: string; patch: any }[] = [];
  const updParcela: { id: string; patch: any }[] = [];

  for (const p of lista) {
    const nome = p.rh_colaboradores.nome;
    const parcelas = parcelasPorPeriodo[p.id] || [];
    const r = resumoPeriodo(p.dias_direito, parcelas, p.dias_abono);

    // 1) Vencimento (limite concessivo): 6/3/1 mês se NÃO programado
    if (!r.completo) {
      const marco6 = addMonths(p.limite_concessivo, -6);
      const marco3 = addMonths(p.limite_concessivo, -3);
      const marco1 = addMonths(p.limite_concessivo, -1);
      const patch: any = {};
      if (hoje >= marco6 && !p.aviso_6m) { patch.aviso_6m = true; eventos.push({ tipo: "Vencimento (6 meses)", colaborador: nome, texto: `Faltam ~6 meses para o vencimento das férias (${fmtBR(p.limite_concessivo)}) e ainda <strong>não há programação</strong>.`, cor: "#D97706" }); }
      else if (hoje >= marco3 && !p.aviso_3m) { patch.aviso_3m = true; eventos.push({ tipo: "Vencimento (3 meses)", colaborador: nome, texto: `Faltam ~3 meses para o vencimento (${fmtBR(p.limite_concessivo)}) sem programação.`, cor: "#EA580C" }); }
      else if (hoje >= marco1 && !p.aviso_1m) { patch.aviso_1m = true; eventos.push({ tipo: "Vencimento (1 mês)", colaborador: nome, texto: `Falta ~1 mês para o vencimento (${fmtBR(p.limite_concessivo)}) sem programação. <strong>Urgente.</strong>`, cor: "#DC2626" }); }

      // 2) Nag semanal enquanto estiver aberto (não programado)
      const ultimoNag = p.nag_semana_em;
      if (!ultimoNag || diffDias(hoje, ultimoNag) >= 7) {
        patch.nag_semana_em = hoje;
        eventos.push({ tipo: "Falta programar", colaborador: nome, texto: `Período aquisitivo ${fmtBR(p.inicio_aquisitivo)}–${fmtBR(p.fim_aquisitivo)} sem programação completa (faltam ${r.faltam} dia(s)).`, cor: "#DC2626" });
      }
      if (Object.keys(patch).length) updPeriodo.push({ id: p.id, patch });
    }

    // marca vencido se o limite passou e não concluiu
    if (p.limite_concessivo < hoje && p.status !== "vencido") {
      updPeriodo.push({ id: p.id, patch: { status: "vencido" } });
    }

    // 3) Parcelas: 30/15/7 dias antes + "dar OK" depois
    for (const pc of parcelas) {
      if (pc.status === "confirmada") continue;
      const dAteInicio = diffDias(pc.data_inicio);
      // reúne marcos pendentes (evita 3 e-mails de uma vez)
      const pendentes: string[] = [];
      const patch: any = {};
      if (dAteInicio <= 30 && dAteInicio >= 0 && !pc.aviso_30) { pendentes.push("30"); patch.aviso_30 = true; }
      if (dAteInicio <= 15 && dAteInicio >= 0 && !pc.aviso_15) { pendentes.push("15"); patch.aviso_15 = true; }
      if (dAteInicio <= 7 && dAteInicio >= 0 && !pc.aviso_7) { pendentes.push("7"); patch.aviso_7 = true; }
      if (pendentes.length) {
        eventos.push({ tipo: "Férias se aproximando", colaborador: nome, texto: `Início em ${fmtBR(pc.data_inicio)} (faltam ${dAteInicio} dia(s)) — ${pc.dias} dia(s).`, cor: "#2563EB" });
      }
      // "dar OK": parcela já terminou e não foi confirmada
      if (pc.data_fim < hoje && !pc.aviso_pos) {
        patch.aviso_pos = true;
        eventos.push({ tipo: "Confirmar férias (dar OK)", colaborador: nome, texto: `As férias de ${fmtBR(pc.data_inicio)} a ${fmtBR(pc.data_fim)} já passaram. Confirme no portal que foram gozadas.`, cor: "#7C3AED" });
      }
      if (Object.keys(patch).length) updParcela.push({ id: pc.id, patch });
    }
  }

  if (!eventos.length) return { eventos: 0, enviados: 0 };
  if (opts.dry) return { eventos: eventos.length, enviados: 0, dry: true, destino: para, detalhe: eventos };

  // ── monta digest ──
  const linhas = eventos.map((e) => `<tr>
    <td style="padding:7px 10px;border-bottom:1px solid #eee"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${e.cor};margin-right:6px"></span>${e.tipo}</td>
    <td style="padding:7px 10px;border-bottom:1px solid #eee"><strong>${e.colaborador}</strong></td>
    <td style="padding:7px 10px;border-bottom:1px solid #eee">${e.texto}</td>
  </tr>`).join("");
  const html = `<div style="font-family:Arial,sans-serif;color:#2D2F36;max-width:720px">
    <h2 style="color:#C41E3A;margin-bottom:4px">🏖 Férias — ${eventos.length} pendência(s)</h2>
    <p style="color:#5B5F6B">Resumo automático da programação de férias.</p>
    <table style="border-collapse:collapse;width:100%;font-size:14px">
      <thead><tr style="background:#F4F6F9"><th style="text-align:left;padding:8px 10px">Evento</th><th style="text-align:left;padding:8px 10px">Colaborador</th><th style="text-align:left;padding:8px 10px">Detalhe</th></tr></thead>
      <tbody>${linhas}</tbody></table>
    <p style="margin-top:20px"><a href="${SITE}/admin/rh?aba=ferias" style="background:#C41E3A;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:700">Abrir Férias no portal</a></p>
    <p style="color:#9CA3AF;font-size:12px;margin-top:24px">Aviso automático — Costa Júnior Engenharia. Lembretes: 6/3/1 mês do vencimento, semanal se não programado, 30/15/7 dias antes e confirmação ao término.</p>
  </div>`;

  let enviados = 0, falhas = 0;
  for (const to of String(para).split(",").map((s: string) => s.trim()).filter(Boolean)) {
    try { await enviarEmailSimples({ to, subject: `🏖 Férias: ${eventos.length} pendência(s)`, html }); enviados++; }
    catch { falhas++; }
  }

  // grava flags só se pelo menos um e-mail saiu
  if (enviados > 0) {
    for (const u of updPeriodo) await db.from("rh_ferias_periodos").update({ ...u.patch, updated_at: new Date().toISOString() }).eq("id", u.id);
    for (const u of updParcela) await db.from("rh_ferias_parcelas").update(u.patch).eq("id", u.id);
  }
  return { eventos: eventos.length, enviados, falhas };
}
