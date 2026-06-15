import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";
import { bloqueioSeSoLeitura } from "../../../../../lib/permissoes";

export const prerender = false;

function limitesMes(mes: string): { inicio: string; fim: string } | null {
  if (!/^\d{4}-\d{2}$/.test(mes)) return null;
  const [ano, m] = mes.split("-").map(Number);
  const inicio = `${mes}-01`;
  const fim = m === 12 ? `${ano + 1}-01-01` : `${ano}-${String(m + 1).padStart(2, "0")}-01`;
  return { inicio, fim };
}

// GET /api/admin/fin/lancamentos?tipo=&status=&categoria_id=&mes=YYYY-MM&busca=
export const GET: APIRoute = async ({ request, url }) => {
  try {
    await requireAdminCookie(request);
    const db = supabaseAdmin();
    let q = db.from("fin_lancamentos")
      .select("*, fin_categorias(nome, cor)")
      .order("data_vencimento", { ascending: false })
      .limit(1000);

    const tipo = url.searchParams.get("tipo");
    const status = url.searchParams.get("status");
    const categoriaId = url.searchParams.get("categoria_id");
    const mes = url.searchParams.get("mes");
    const busca = url.searchParams.get("busca");

    if (tipo && tipo !== "todos") q = q.eq("tipo", tipo);
    if (status && status !== "todos") q = q.eq("status", status);
    if (categoriaId && categoriaId !== "todas") q = q.eq("categoria_id", categoriaId);
    if (mes) {
      const lim = limitesMes(mes);
      if (lim) q = q.gte("data_vencimento", lim.inicio).lt("data_vencimento", lim.fim);
    }
    if (busca) {
      const b = busca.replace(/[%,()]/g, " ").trim();
      if (b) q = q.or(`descricao.ilike.%${b}%,fornecedor_cliente.ilike.%${b}%`);
    }

    const { data, error } = await q;
    if (error) return jsonErr(500, error.message);
    return jsonOk(data || []);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// POST /api/admin/fin/lancamentos — cria lançamento (receita ou despesa)
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const _ro = await bloqueioSeSoLeitura(admin, "financeiro"); if (_ro) return _ro;
    const body = await request.json();
    const { tipo, descricao, valor, data_vencimento } = body;
    if (!tipo || !descricao || valor === undefined || valor === null || valor === "" || !data_vencimento)
      return jsonErr(400, "Tipo, descrição, valor e data de vencimento são obrigatórios");
    if (!["receita", "despesa"].includes(tipo)) return jsonErr(400, "Tipo inválido");
    const valorNum = Number(valor);
    if (isNaN(valorNum) || valorNum < 0) return jsonErr(400, "Valor deve ser um número maior ou igual a zero");
    if (body.status && !["previsto", "pago", "atrasado", "cancelado"].includes(body.status)) return jsonErr(400, "Status inválido");

    const campos = [
      "tipo", "descricao", "categoria_id", "valor", "data_vencimento", "data_pagamento",
      "status", "forma_pagamento", "fornecedor_cliente", "obra_id", "documento_url",
      "recorrente", "observacoes",
    ];
    const row: Record<string, unknown> = { criado_por: admin.email };
    for (const c of campos) if (body[c] !== undefined && body[c] !== "") row[c] = body[c];

    const db = supabaseAdmin();
    const { data, error } = await db.from("fin_lancamentos").insert(row).select().single();
    if (error) return jsonErr(400, error.message);
    await registrarAcao(db, { req: request, admin }, {
      acao: "criar",
      entidade: "fin_lancamentos",
      registro_id: data?.id ?? null,
      descricao: `Lançou ${tipo === "receita" ? "conta a receber" : "conta a pagar"} "${descricao}" R$ ${valorNum.toFixed(2)}`,
      dados: data,
    });
    return jsonOk(data, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
