import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { calcularPeriodo, ciclosVencidos, resumoPeriodo, addDays, addMonths } from "../../../../../lib/ferias";
import { registrarAcao } from "../../../../../lib/auditoria";
import { bloqueioSeSoLeitura } from "../../../../../lib/permissoes";

export const prerender = false;

// GET /api/admin/rh/ferias
//   ?colaborador_id=  → períodos+parcelas de um colaborador
//   (sem filtro)      → todos os períodos abertos (CLT ativos) com resumo, p/ a aba
export const GET: APIRoute = async ({ request, url }) => {
  try {
    await requireAdminCookie(request);
    const db = supabaseAdmin();
    const colaboradorId = url.searchParams.get("colaborador_id");

    if (colaboradorId) {
      const { data: periodos } = await db.from("rh_ferias_periodos")
        .select("*").eq("colaborador_id", colaboradorId).order("inicio_aquisitivo", { ascending: false });
      const ids = (periodos || []).map((p: any) => p.id);
      let parcelas: any[] = [];
      if (ids.length) {
        const { data } = await db.from("rh_ferias_parcelas").select("*").in("periodo_id", ids).order("data_inicio", { ascending: true });
        parcelas = data || [];
      }
      const out = (periodos || []).map((p: any) => {
        const pcs = parcelas.filter((x) => x.periodo_id === p.id);
        return { ...p, parcelas: pcs, resumo: resumoPeriodo(p.dias_direito, pcs, p.dias_abono) };
      });
      return jsonOk(out);
    }

    // HISTÓRICO: períodos já concluídos (qualquer colaborador, inclusive desligado).
    // Mantido fora do painel principal — só aparece quando pedido explicitamente.
    if (url.searchParams.get("historico") === "1") {
      const { data: concl } = await db.from("rh_ferias_periodos")
        .select("*, rh_colaboradores(nome, regime, status)")
        .eq("status", "concluido").order("fim_aquisitivo", { ascending: false }).limit(3000);
      const ids = (concl || []).map((p: any) => p.id);
      let parcelas: any[] = [];
      if (ids.length) { const { data } = await db.from("rh_ferias_parcelas").select("*").in("periodo_id", ids).order("data_inicio", { ascending: true }); parcelas = data || []; }
      const out = (concl || []).map((p: any) => ({
        id: p.id, colaborador: p.rh_colaboradores?.nome || "—",
        inicio_aquisitivo: p.inicio_aquisitivo, fim_aquisitivo: p.fim_aquisitivo,
        limite_concessivo: p.limite_concessivo, dias_direito: p.dias_direito, dias_abono: p.dias_abono || 0,
        parcelas: parcelas.filter((x) => x.periodo_id === p.id),
      }));
      return jsonOk(out);
    }

    // visão geral: períodos não concluídos de CLT ativos
    const { data: periodos } = await db.from("rh_ferias_periodos")
      .select("*, rh_colaboradores(nome, regime, status)")
      .neq("status", "concluido").limit(3000);
    const lista = (periodos || []).filter((p: any) => p.rh_colaboradores && (p.rh_colaboradores.regime === "clt" || p.rh_colaboradores.regime === "pj") && p.rh_colaboradores.status !== "desligado");
    const ids = lista.map((p: any) => p.id);
    let parcelas: any[] = [];
    if (ids.length) {
      const { data } = await db.from("rh_ferias_parcelas").select("*").in("periodo_id", ids).order("data_inicio", { ascending: true });
      parcelas = data || [];
    }
    const out = lista.map((p: any) => {
      const pcs = parcelas.filter((x) => x.periodo_id === p.id);
      return {
        id: p.id, colaborador_id: p.colaborador_id, colaborador: p.rh_colaboradores.nome,
        inicio_aquisitivo: p.inicio_aquisitivo, fim_aquisitivo: p.fim_aquisitivo,
        limite_concessivo: p.limite_concessivo, dias_direito: p.dias_direito, status: p.status,
        parcelas: pcs, resumo: resumoPeriodo(p.dias_direito, pcs, p.dias_abono),
      };
    }).sort((a: any, b: any) => (a.completo === b.completo ? 0 : a.resumo.completo ? 1 : -1) || (a.limite_concessivo < b.limite_concessivo ? -1 : 1));
    return jsonOk(out);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// POST /api/admin/rh/ferias
//   { seed: true }                  → cria o período atual de todos os CLT ativos sem período
//   { colaborador_id, ... }         → cria um período (datas calculadas da admissão se omitidas)
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const _ro = await bloqueioSeSoLeitura(admin, "rh"); if (_ro) return _ro;
    const body = await request.json();
    const db = supabaseAdmin();

    if (body.seed) {
      const { data: colabs } = await db.from("rh_colaboradores")
        .select("id, nome, data_admissao, regime, status").in("regime", ["clt", "pj"]).neq("status", "desligado").neq("status", "congelado").limit(2000);
      const { data: existentes } = await db.from("rh_ferias_periodos").select("colaborador_id, inicio_aquisitivo").limit(5000);
      const jaTem = new Set((existentes || []).map((e: any) => `${e.colaborador_id}|${e.inicio_aquisitivo}`));
      const novos: any[] = [];
      let semAdmissao = 0;
      for (const c of colabs || []) {
        if (!c.data_admissao) { semAdmissao++; continue; }
        const ciclos = ciclosVencidos(c.data_admissao);
        const ciclo = Math.max(0, ciclos - 1); // período atual a programar
        const per = calcularPeriodo(c.data_admissao, ciclo);
        if (jaTem.has(`${c.id}|${per.inicio_aquisitivo}`)) continue;
        novos.push({ colaborador_id: c.id, ...per, status: "aberto" });
      }
      let criados = 0;
      for (let i = 0; i < novos.length; i += 200) {
        const { data, error } = await db.from("rh_ferias_periodos").insert(novos.slice(i, i + 200)).select("id");
        if (error) return jsonErr(500, `Erro ao semear: ${error.message}`);
        criados += data?.length || 0;
      }
      if (criados > 0) {
        await registrarAcao(db, { req: request, admin }, {
          acao: "criar",
          entidade: "rh_ferias_periodos",
          registro_id: null,
          descricao: `Gerou períodos de férias para ${criados} colaborador(es) CLT`,
          dados: { criados, sem_admissao: semAdmissao },
        });
      }
      return jsonOk({ ok: true, criados, ja_existiam: (colabs || []).length - novos.length - semAdmissao, sem_admissao: semAdmissao });
    }

    // ── HISTÓRICO: lança um período de férias JÁ GOZADO (passado), só para registro.
    //    Cria o período com status="concluido" e as parcelas como "confirmada" — então
    //    NÃO dispara alerta nenhum (os lembretes excluem status=concluido e pulam parcelas
    //    confirmadas). Vai direto para o "📜 Histórico" do colaborador.
    if (body.historico) {
      if (!body.colaborador_id) return jsonErr(400, "colaborador_id é obrigatório");
      const isData = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !isNaN(new Date(s + "T00:00:00Z").getTime());
      const entrada = Array.isArray(body.parcelas) ? body.parcelas : [];
      const norm: any[] = [];
      for (const p of entrada) {
        const dias = parseInt(p.dias, 10);
        if (!isData(p.data_inicio)) return jsonErr(400, `Data de início inválida: "${p.data_inicio}"`);
        if (isNaN(dias) || dias < 1 || dias > 30) return jsonErr(400, "Cada parcela precisa ter entre 1 e 30 dias gozados.");
        norm.push({ data_inicio: p.data_inicio, dias, data_fim: addDays(p.data_inicio, dias - 1) });
      }
      if (!norm.length) return jsonErr(400, "Informe ao menos um período gozado (data e dias).");

      // período aquisitivo: usa o informado ou deriva (~12 meses antes do 1º gozo)
      let inicio_aquisitivo = body.inicio_aquisitivo;
      if (!isData(inicio_aquisitivo)) {
        const primeira = norm.map((p) => p.data_inicio).sort()[0];
        inicio_aquisitivo = addMonths(primeira, -12);
      }
      const fim_aquisitivo = addDays(addMonths(inicio_aquisitivo, 12), -1);
      const limite_concessivo = addMonths(fim_aquisitivo, 12);
      const ABONOS = [0, 10, 15, 20, 30];
      const abono = ABONOS.includes(parseInt(body.dias_abono, 10)) ? parseInt(body.dias_abono, 10) : 0;

      const { data: per, error: ePer } = await db.from("rh_ferias_periodos").insert({
        colaborador_id: body.colaborador_id,
        inicio_aquisitivo, fim_aquisitivo, limite_concessivo,
        dias_direito: 30, dias_abono: abono, status: "concluido",
        observacoes: body.observacoes || "Período histórico (lançamento manual)",
      }).select().single();
      if (ePer) {
        const dup = /duplicate|unique|23505/i.test(ePer.message || "");
        return jsonErr(400, dup
          ? "Já existe um período com esse início de aquisitivo para este colaborador — informe outra data de início do período aquisitivo."
          : ePer.message);
      }

      const linhas = norm.map((p) => ({
        periodo_id: per.id, colaborador_id: body.colaborador_id,
        data_inicio: p.data_inicio, dias: p.dias, data_fim: p.data_fim,
        status: "confirmada", confirmada_em: new Date().toISOString(), confirmada_por: admin.email,
      }));
      const { error: ePar } = await db.from("rh_ferias_parcelas").insert(linhas);
      if (ePar) { await db.from("rh_ferias_periodos").delete().eq("id", per.id); return jsonErr(400, ePar.message); }

      await registrarAcao(db, { req: request, admin }, {
        acao: "criar",
        entidade: "rh_ferias_periodos",
        registro_id: per.id,
        descricao: `Lançou período de férias HISTÓRICO (concluído, sem alertas) — ${norm.length} parcela(s), aquisitivo ${inicio_aquisitivo}`,
        dados: { periodo: per, parcelas: linhas },
      });
      return jsonOk({ ok: true, periodo_id: per.id, parcelas: linhas.length, historico: true }, 201);
    }

    if (!body.colaborador_id) return jsonErr(400, "colaborador_id é obrigatório");
    let dados = { inicio_aquisitivo: body.inicio_aquisitivo, fim_aquisitivo: body.fim_aquisitivo, limite_concessivo: body.limite_concessivo, dias_direito: body.dias_direito || 30 };
    if (!dados.inicio_aquisitivo || !dados.fim_aquisitivo || !dados.limite_concessivo) {
      const { data: c } = await db.from("rh_colaboradores").select("data_admissao").eq("id", body.colaborador_id).maybeSingle();
      if (!c?.data_admissao) return jsonErr(400, "Colaborador sem data de admissão — informe as datas do período manualmente.");
      const ciclos = ciclosVencidos(c.data_admissao);
      dados = calcularPeriodo(c.data_admissao, Math.max(0, ciclos - 1));
    }
    const { data, error } = await db.from("rh_ferias_periodos")
      .insert({ colaborador_id: body.colaborador_id, ...dados, status: "aberto", observacoes: body.observacoes || null }).select().single();
    if (error) return jsonErr(400, error.message);
    await registrarAcao(db, { req: request, admin }, {
      acao: "criar",
      entidade: "rh_ferias_periodos",
      registro_id: data.id,
      descricao: `Criou período aquisitivo de férias (aquisitivo ${dados.inicio_aquisitivo} a ${dados.fim_aquisitivo})`,
      dados: data,
    });
    return jsonOk(data, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
