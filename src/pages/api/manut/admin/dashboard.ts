import type { APIRoute } from "astro";
import { requireAdmin, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    await requireAdmin(request);
    const db = supabaseAdmin();

    const [
      clientesRes,
      chamadosRes,
      tecnicosRes,
      pagamentosRes,
      suporteRes,
      chamadosRecentesRes,
    ] = await Promise.all([
      db.from("manut_clientes").select("id,status,valor_mensal_contratado"),
      db.from("manut_chamados").select("id,status,tipo,created_at").order("created_at", { ascending: false }).limit(1000),
      db.from("manut_tecnicos").select("id,status"),
      db.from("manut_pagamentos").select("id,status,valor"),
      db.from("manut_suporte").select("id,status").eq("status", "aberto"),
      db.from("manut_chamados")
        .select("id,tipo,status,prioridade,data_abertura,manut_clientes(nome),manut_lojas(nome)")
        .order("data_abertura", { ascending: false })
        .limit(10),
    ]);

    const clientes = clientesRes.data || [];
    const chamados = chamadosRes.data || [];
    const tecnicos = tecnicosRes.data || [];
    const pagamentos = pagamentosRes.data || [];

    const stats = {
      clientes: {
        total: clientes.length,
        ativos: clientes.filter((c: any) => c.status === "ativo").length,
        inadimplentes: clientes.filter((c: any) => c.status === "inadimplente").length,
        pendentes: clientes.filter((c: any) => c.status === "pendente").length,
        cancelados: clientes.filter((c: any) => c.status === "cancelado").length,
        receitaMensal: clientes
          .filter((c: any) => c.status === "ativo")
          .reduce((acc: number, c: any) => acc + (Number(c.valor_mensal_contratado) || 0), 0),
      },
      chamados: {
        total: chamados.length,
        abertos: chamados.filter((c: any) => c.status === "aberto").length,
        em_andamento: chamados.filter((c: any) => c.status === "em_andamento").length,
        aguardando_material: chamados.filter((c: any) => c.status === "aguardando_material").length,
        concluidos: chamados.filter((c: any) => c.status === "concluido").length,
      },
      tecnicos: {
        total: tecnicos.length,
        ativos: tecnicos.filter((t: any) => t.status === "ativo").length,
      },
      pagamentos: {
        pendentes: pagamentos.filter((p: any) => p.status === "pendente").length,
        atrasados: pagamentos.filter((p: any) => p.status === "atrasado").length,
        valorPendente: pagamentos
          .filter((p: any) => ["pendente", "atrasado"].includes(p.status))
          .reduce((acc: number, p: any) => acc + Number(p.valor), 0),
      },
      suporte: { abertos: (suporteRes.data || []).length },
    };

    return jsonOk({ stats, chamadosRecentes: chamadosRecentesRes.data || [] });
  } catch (e: any) {
    return jsonErr(e.message === "Não autorizado" ? 401 : 500, e.message);
  }
};
