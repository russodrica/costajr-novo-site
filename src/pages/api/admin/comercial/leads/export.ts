import type { APIRoute } from "astro";
import { requireAdminCookie } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { perfisFrescos } from "../../../../../lib/permissoes";

export const prerender = false;

function csv(v: unknown) { const s = v == null ? "" : String(v); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }

// GET /api/admin/comercial/leads/export
//   ?modelo=1 → modelo (planilha base) em branco para importar — liberado a quem tem CRM
//   (sem modelo) → EXPORTA os leads em CSV — RESTRITO AO ADMINISTRADOR
export const GET: APIRoute = async ({ request, url }) => {
  try {
    const admin = await requireAdminCookie(request);

    // ── Modelo / base em branco para preencher e importar ──
    if (url.searchParams.get("modelo")) {
      const instr = [
        "# INSTRUCOES — apague as linhas com # antes de importar",
        "# Preencha 1 lead por linha. So Nome e obrigatorio.",
        "# Etapa (opcional): novo, contato_feito, proposta_enviada, negociando, convertido, perdido (vazio = novo).",
        "# Valor com virgula ou ponto (ex.: 1500,00). Salve como CSV (separador ponto-e-virgula).",
      ];
      const headers = ["Nome", "Loja", "E-mail", "Telefone", "Plano", "Valor", "Etapa", "Responsavel"];
      const ex = ["Empresa Exemplo Ltda", "Loja Centro", "contato@exemplo.com", "11 99999-0000", "Plano X", "1500,00", "novo", "Adriana"];
      const out = "﻿" + [...instr, headers.join(";"), ex.map(csv).join(";")].join("\r\n");
      return new Response(out, { status: 200, headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="modelo-importacao-leads.csv"' } });
    }

    // ── Export dos dados: SÓ ADMINISTRADOR ──
    const perfis = await perfisFrescos(admin);
    if (!perfis.includes("admin")) return new Response("Exportação de leads restrita ao administrador.", { status: 403 });

    const db = supabaseAdmin();
    const { data, error } = await db.from("manut_leads").select("*").order("created_at", { ascending: false }).limit(20000);
    if (error) return new Response(error.message, { status: 500 });

    const COLUNAS = ["ID", "Nome", "Loja", "E-mail", "Telefone", "Plano", "Valor", "Etapa", "Responsavel", "Origem", "Criado em"];
    const linhas = (data || []).map((l: any) => [
      l.id, l.nome, l.nome_loja, l.email, l.telefone, l.plano, l.valor, l.etapa, l.responsavel, l.origem, l.created_at,
    ].map(csv).join(";"));
    const out = "﻿" + [COLUNAS.join(";"), ...linhas].join("\r\n");
    const hoje = new Date().toISOString().slice(0, 10);
    return new Response(out, { status: 200, headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="leads-${hoje}.csv"` } });
  } catch (e: any) {
    return new Response(e.message === "Não autenticado" ? "Não autenticado" : e.message, { status: e.message === "Não autenticado" ? 401 : 500 });
  }
};
