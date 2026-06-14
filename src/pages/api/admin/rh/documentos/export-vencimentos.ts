import type { APIRoute } from "astro";
import { requireAdminCookie } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";

export const prerender = false;

const TIPOS: Record<string, string> = {
  contrato: "Contrato", aso: "ASO", ficha_epi: "Ficha EPI", advertencia: "Advertência",
  atestado: "Atestado", certificado: "Certificado", cnh: "CNH", outro: "Outro",
};
function csv(v: unknown) { const s = v == null ? "" : String(v); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }

// GET /api/admin/rh/documentos/export-vencimentos → CSV de documentos vencidos + vencendo (90 dias)
export const GET: APIRoute = async ({ request }) => {
  try {
    await requireAdminCookie(request);
    const db = supabaseAdmin();
    const limite = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
    const hoje = new Date().toISOString().slice(0, 10);

    const { data, error } = await db.from("rh_documentos")
      .select("titulo, tipo, validade, rh_colaboradores(nome, cargo, setor, status, regime)")
      .not("validade", "is", null).lte("validade", limite).order("validade", { ascending: true }).limit(5000);
    if (error) return new Response(error.message, { status: 500 });

    const cols = ["Colaborador", "Cargo", "Setor", "Documento", "Tipo", "Validade", "Situação"];
    // Não inclui DESLIGADOS (inativos) nem DIARISTAS (esporádicos) no relatório de vencimentos.
    const linhas = (data || [])
      .filter((d: any) => { const c = d.rh_colaboradores; return c && c.status !== "desligado" && c.regime !== "diarista"; })
      .map((d: any) => {
      const venc = d.validade < hoje;
      return [
        d.rh_colaboradores?.nome, d.rh_colaboradores?.cargo, d.rh_colaboradores?.setor,
        d.titulo, TIPOS[d.tipo] || d.tipo, d.validade.split("-").reverse().join("/"),
        venc ? "VENCIDO" : "A vencer",
      ].map(csv).join(";");
    });
    const conteudo = "﻿" + [cols.join(";"), ...linhas].join("\r\n");
    return new Response(conteudo, {
      status: 200,
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="rh-vencimentos-${hoje}.csv"` },
    });
  } catch (e: any) {
    return new Response(e.message === "Não autenticado" ? "Não autenticado" : e.message, { status: e.message === "Não autenticado" ? 401 : 500 });
  }
};
