import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";

export const prerender = false;

// Tipos de documento críticos para canteiro (não pode trabalhar sem) — destaque máximo.
const TIPOS_CRITICOS = new Set(["aso", "cnh"]);
function ehCritico(doc: any): boolean {
  if (TIPOS_CRITICOS.has(doc.tipo)) return true;
  // NRs e certificados de segurança pelo título
  return /\bNR-?\s?\d|\baso\b|\bcnh\b|seguran[çc]a/i.test(doc.titulo || "");
}
function diasAte(validade: string): number {
  const v = new Date(`${validade}T00:00:00Z`).getTime();
  const h = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").getTime();
  return Math.round((v - h) / 86400000);
}

// GET /api/admin/rh/alertas — visão consolidada de vencimentos e compliance.
export const GET: APIRoute = async ({ request }) => {
  try {
    await requireAdminCookie(request);
    const db = supabaseAdmin();
    const hoje = new Date().toISOString().slice(0, 10);
    const limite = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10); // janela de 60 dias

    const [{ data: docs }, { data: colabs }, { data: docsAso }, { data: ausencias }] = await Promise.all([
      db.from("rh_documentos").select("id, titulo, tipo, validade, colaborador_id, rh_colaboradores(nome)")
        .not("validade", "is", null).lte("validade", limite).order("validade", { ascending: true }).limit(2000),
      db.from("rh_colaboradores").select("id, nome, cargo, setor").eq("status", "ativo"),
      db.from("rh_documentos").select("colaborador_id").eq("tipo", "aso"),
      db.from("rh_ausencias").select("id, tipo, data_inicio, data_fim, status, rh_colaboradores(nome)")
        .lte("data_inicio", new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10))
        .gte("data_fim", hoje).in("status", ["aprovada", "solicitada"]).order("data_inicio").limit(200),
    ]);

    const mapDoc = (d: any) => ({
      id: d.id, titulo: d.titulo, tipo: d.tipo, validade: d.validade,
      dias: diasAte(d.validade), critico: ehCritico(d),
      colaborador: d.rh_colaboradores?.nome || "—", colaborador_id: d.colaborador_id,
    });

    const todos = (docs || []).map(mapDoc);
    const vencidos = todos.filter((d) => d.dias < 0);
    const vencendo = todos.filter((d) => d.dias >= 0); // 0..60 dias

    // colaboradores ativos sem ASO cadastrado
    const comAso = new Set((docsAso || []).map((d: any) => d.colaborador_id));
    const semAso = (colabs || []).filter((c) => !comAso.has(c.id)).map((c) => ({ id: c.id, nome: c.nome, cargo: c.cargo, setor: c.setor }));

    return jsonOk({
      resumo: {
        vencidos: vencidos.length,
        criticos_vencidos: vencidos.filter((d) => d.critico).length,
        vencendo_7: vencendo.filter((d) => d.dias <= 7).length,
        vencendo_30: vencendo.filter((d) => d.dias <= 30).length,
        sem_aso: semAso.length,
        ferias_periodo: (ausencias || []).length,
      },
      vencidos,
      vencendo,
      sem_aso: semAso,
      ausencias_periodo: (ausencias || []).map((a: any) => ({
        id: a.id, tipo: a.tipo, data_inicio: a.data_inicio, data_fim: a.data_fim,
        status: a.status, colaborador: a.rh_colaboradores?.nome || "—",
      })),
    });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
