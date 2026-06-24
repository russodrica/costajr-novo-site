import type { APIRoute } from "astro";
import { requireAdminCookie, temPerfil, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";

export const prerender = false;
const PERFIS = ["admin", "financeiro", "juridico"];
const TIPOS = ["emprestimo", "financiamento"];
const STATUS = ["ativo", "quitado", "renegociado"];

const num = (v: any) => (v != null && v !== "" && !isNaN(Number(v)) ? Number(v) : null);

export const GET: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const db = supabaseAdmin();
    const { data } = await db.from("doc_emprestimos").select("*").order("status").order("data_contratacao", { ascending: false });
    return jsonOk(data || []);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const b = await request.json();
    const descricao = String(b.descricao || "").trim();
    if (!descricao) return jsonErr(400, "Informe a descrição.");
    const tipo = TIPOS.includes(b.tipo) ? b.tipo : "emprestimo";
    const status = STATUS.includes(b.status) ? b.status : "ativo";
    const db = supabaseAdmin();
    const { data, error } = await db.from("doc_emprestimos").insert({
      tipo, status, descricao,
      banco: b.banco ? String(b.banco).trim() : null,
      valor_total: num(b.valor_total), num_parcelas: num(b.num_parcelas), valor_parcela: num(b.valor_parcela),
      data_contratacao: b.data_contratacao || null, data_primeira_parcela: b.data_primeira_parcela || null,
      observacao: b.observacao || null, criado_por: admin.email,
    }).select().single();
    if (error) return jsonErr(500, error.message);
    await registrarAcao(db, { req: request, admin }, { acao: "criar", entidade: "doc_emprestimos", registro_id: data?.id ?? null, descricao: `Cadastrou ${tipo}: ${descricao}`, dados: { tipo, banco: b.banco } }).catch(() => {});
    return jsonOk(data, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
