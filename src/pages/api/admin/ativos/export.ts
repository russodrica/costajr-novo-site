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

// Colunas na MESMA ordem usada pela importação (export ↔ import compatíveis).
// As 2 últimas (Status / Com quem) são só leitura — a importação as ignora.
const COLUNAS_ATIVOS = [
  "ID", "Categoria", "Descrição", "Subcategoria", "Código interno", "Nº patrimonial", "Nº de série",
  "Marca", "Modelo", "Fabricante", "Valor aquisição", "Data aquisição", "Fornecedor",
  "Nº nota fiscal", "Garantia até", "Campos específicos", "Observações", "Status", "Com quem / onde",
];

function csvCampo(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function serializarCampos(campos: Record<string, unknown> | null | undefined): string {
  if (!campos || typeof campos !== "object") return "";
  return Object.entries(campos).filter(([, v]) => v != null && v !== "").map(([k, v]) => `${k}=${v}`).join("; ");
}

// GET /api/admin/ativos/export?categoria=&status=&busca=  → CSV do inventário (respeita filtros)
//     /api/admin/ativos/export?modelo=1                   → modelo em branco p/ importação em massa
export const GET: APIRoute = async ({ request, url }) => {
  try {
    await requireAdminCookie(request);

    // Modo modelo: cabeçalho + 1 linha de exemplo + instruções
    if (url.searchParams.get("modelo")) {
      const exemplo = [
        "", "telefonia", "Smartphone Samsung A54", "Celular corporativo", "TI-001", "PAT-1024", "SN123456",
        "Samsung", "Galaxy A54", "Samsung", "1800.00", "2026-01-15", "Loja XYZ",
        "NF-5567", "2027-01-15", "imei1=350000000000001; linha=11 99999-0000; operadora=Vivo", "Aparelho novo", "", "",
      ];
      const instrucoes = [
        "# INSTRUÇÕES — apague estas linhas antes de importar (linhas que começam com # são ignoradas)",
        "# ID: deixe VAZIO para criar um ativo novo. Preencha (copiando do export) só para ATUALIZAR um existente.",
        "# Categoria: use exatamente um destes — telefonia, informatica, equipamento_obra, epi, veiculo, mobiliario, outros",
        "# Datas no formato AAAA-MM-DD. Valor com ponto decimal (1800.00).",
        "# Garantia até: se preencher a data, o ativo fica marcado como 'com garantia'.",
        "# Campos específicos: pares chave=valor separados por ponto-e-vírgula. Ex: imei1=...; placa=ABC1D23; ano=2022",
        "# Status e 'Com quem/onde' são ignorados na importação (mude isso pelas ações do ativo).",
      ];
      const csv = "﻿" + [...instrucoes, COLUNAS_ATIVOS.join(";"), exemplo.map(csvCampo).join(";")].join("\r\n");
      return new Response(csv, {
        status: 200,
        headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="modelo-importacao-ativos.csv"' },
      });
    }

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

    const linhas = (data || []).map((a: any) => [
      a.id, CATEGORIAS[a.categoria] || a.categoria, a.descricao, a.subcategoria, a.codigo_interno,
      a.numero_patrimonial, a.numero_serie, a.marca, a.modelo, a.fabricante,
      a.valor_aquisicao, a.data_aquisicao, a.fornecedor, a.numero_nota_fiscal,
      a.garantia ? a.garantia_fim : "", serializarCampos(a.campos), a.observacoes,
      STATUS[a.status] || a.status, a.alocado_para_nome,
    ].map(csvCampo).join(";"));

    const csv = "﻿" + [COLUNAS_ATIVOS.join(";"), ...linhas].join("\r\n");
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
