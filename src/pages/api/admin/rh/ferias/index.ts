import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { calcularPeriodo, ciclosVencidos, resumoPeriodo } from "../../../../../lib/ferias";
import { registrarAcao } from "../../../../../lib/auditoria";

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
        return { ...p, parcelas: pcs, resumo: resumoPeriodo(p.dias_direito, pcs) };
      });
      return jsonOk(out);
    }

    // visão geral: períodos não concluídos de CLT ativos
    const { data: periodos } = await db.from("rh_ferias_periodos")
      .select("*, rh_colaboradores(nome, regime, status)")
      .neq("status", "concluido").limit(3000);
    const lista = (periodos || []).filter((p: any) => p.rh_colaboradores && p.rh_colaboradores.regime === "clt" && p.rh_colaboradores.status !== "desligado");
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
        parcelas: pcs, resumo: resumoPeriodo(p.dias_direito, pcs),
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
    const body = await request.json();
    const db = supabaseAdmin();

    if (body.seed) {
      const { data: colabs } = await db.from("rh_colaboradores")
        .select("id, nome, data_admissao, regime, status").eq("regime", "clt").neq("status", "desligado").limit(2000);
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
