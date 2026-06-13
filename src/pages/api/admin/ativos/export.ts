import type { APIRoute } from "astro";
import { requireAdminCookie } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";

export const prerender = false;

const CATEGORIAS: Record<string, string> = {
  telefonia: "Telefonia", informatica: "Informática", equipamento_obra: "Equip. de Obra",
  epi: "EPI", veiculo: "Veículo", mobiliario: "Mobiliário", outros: "Outros",
};
const STATUS: Record<string, string> = {
  em_estoque: "Em estoque", disponivel: "Disponível", alocado: "Alocado", em_manutencao: "Em manutenção",
  em_transito: "Em trânsito", extraviado: "Extraviado", roubado: "Roubado", danificado: "Danificado",
  baixado: "Baixado", descartado: "Descartado",
};

function csvCampo(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// GET /api/admin/ativos/export?categoria=&status=&busca= → CSV do inventário (respeita filtros)
export const GET: APIRoute = async ({ request, url }) => {
  try {
    await requireAdminCookie(request);
    const db = supabaseAdmin();
    let q = db.from("ativos").select("*").order("categoria").order("descricao").limit(5000);

    const categoria = url.searchParams.get("categoria");
    const status = url.searchParams.get("status");
    const busca = url.searchParams.get("busca");
    if (categoria && categoria !== "todas") q = q.eq("categoria", categoria);
    if (status && status !== "todos") q = q.eq("status", status);
    if (busca) {
      const b = busca.replace(/[%,()]/g, " ").trim();
      q = q.or(`descricao.ilike.%${b}%,marca.ilike.%${b}%,modelo.ilike.%${b}%,numero_serie.ilike.%${b}%,numero_patrimonial.ilike.%${b}%,codigo_interno.ilike.%${b}%,alocado_para_nome.ilike.%${b}%`);
    }
    const { data, error } = await q;
    if (error) return new Response(error.message, { status: 500 });

    const colunas = [
      "Categoria", "Descrição", "Subcategoria", "Código interno", "Nº patrimonial", "Nº de série",
      "Marca", "Modelo", "Fabricante", "Status", "Com quem / onde", "Tipo alocação",
      "Valor aquisição (R$)", "Data aquisição", "Fornecedor", "Nota fiscal", "Garantia até", "Observações",
    ];
    const linhas = (data || []).map((a: any) => [
      CATEGORIAS[a.categoria] || a.categoria, a.descricao, a.subcategoria, a.codigo_interno,
      a.numero_patrimonial, a.numero_serie, a.marca, a.modelo, a.fabricante,
      STATUS[a.status] || a.status, a.alocado_para_nome, a.alocado_para_tipo,
      a.valor_aquisicao, a.data_aquisicao, a.fornecedor, a.numero_nota_fiscal,
      a.garantia ? a.garantia_fim : "", a.observacoes,
    ].map(csvCampo).join(";"));

    // BOM p/ Excel reconhecer UTF-8 + cabeçalho
    const csv = "﻿" + [colunas.join(";"), ...linhas].join("\r\n");
    const hoje = new Date().toISOString().slice(0, 10);
    return new Response(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="inventario-ativos-${hoje}.csv"`,
      },
    });
  } catch (e: any) {
    return new Response(e.message === "Não autenticado" ? "Não autenticado" : e.message, { status: e.message === "Não autenticado" ? 401 : 500 });
  }
};
