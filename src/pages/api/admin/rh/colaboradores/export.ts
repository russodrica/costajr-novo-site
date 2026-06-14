import type { APIRoute } from "astro";
import { requireAdminCookie } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";

export const prerender = false;

const REGIMES: Record<string, string> = { clt: "CLT", pj: "PJ", estagio: "Estágio", temporario: "Temporário", socio: "Sócio" };
const STATUS: Record<string, string> = { ativo: "Ativo", ferias: "Férias", afastado: "Afastado", desligado: "Desligado" };

const COLUNAS = [
  "ID", "Nome", "E-mail corporativo", "E-mail pessoal", "Telefone empresa", "Telefone pessoal", "CPF", "RG", "Data nascimento", "Cargo", "Setor",
  "Regime", "Salário", "Data admissão", "Status", "Cidade", "UF", "PIX", "Banco", "Agência", "Conta", "Observações",
];
function csv(v: unknown) { const s = v == null ? "" : String(v); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }

// GET /api/admin/rh/colaboradores/export?status=&setor=&busca=  → CSV
//     ?modelo=1 → modelo em branco para importação em massa
export const GET: APIRoute = async ({ request, url }) => {
  try {
    await requireAdminCookie(request);

    if (url.searchParams.get("modelo")) {
      const instr = [
        "# INSTRUÇÕES — apague as linhas com # antes de importar",
        "# ID: vazio = cria colaborador novo; preenchido (do export) = atualiza existente",
        "# Regime: clt, pj, estagio, temporario ou socio. Status: ativo, ferias, afastado, desligado",
        "# Datas no formato AAAA-MM-DD. Salário com ponto decimal (2500.00).",
      ];
      const ex = ["", "João da Silva", "joao@costajr.com.br", "joao.pessoal@gmail.com", "11 4000-0000", "11 99999-0000", "111.222.333-44", "12.345.678-9",
        "1990-05-20", "Pedreiro", "Obra", "clt", "2500.00", "2026-01-10", "ativo", "São Paulo", "SP", "", "", "", "", ""];
      const out = "﻿" + [...instr, COLUNAS.join(";"), ex.map(csv).join(";")].join("\r\n");
      return new Response(out, { status: 200, headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="modelo-importacao-colaboradores.csv"' } });
    }

    const db = supabaseAdmin();
    let q = db.from("rh_colaboradores").select("*").order("nome").limit(5000);
    const status = url.searchParams.get("status");
    const setor = url.searchParams.get("setor");
    if (status && status !== "todos") q = q.eq("status", status);
    if (setor) q = q.eq("setor", setor);
    const { data, error } = await q;
    if (error) return new Response(error.message, { status: 500 });

    const linhas = (data || []).map((c: any) => [
      c.id, c.nome, c.email, c.telefone, c.cpf, c.rg, c.data_nascimento, c.cargo, c.setor,
      REGIMES[c.regime] || c.regime, c.salario, c.data_admissao, STATUS[c.status] || c.status,
      c.cidade, c.uf, c.pix, c.banco, c.agencia, c.conta, c.observacoes,
    ].map(csv).join(";"));
    const out = "﻿" + [COLUNAS.join(";"), ...linhas].join("\r\n");
    const hoje = new Date().toISOString().slice(0, 10);
    return new Response(out, { status: 200, headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="colaboradores-${hoje}.csv"` } });
  } catch (e: any) {
    return new Response(e.message === "Não autenticado" ? "Não autenticado" : e.message, { status: e.message === "Não autenticado" ? 401 : 500 });
  }
};
