import type { APIRoute } from "astro";
import { requireAdminCookie, temPerfil, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";

export const prerender = false;
const PERFIS = ["admin", "financeiro", "juridico"];

// GET → lista faturas. POST → registra uma fatura já enviada ao bucket.
export const GET: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const db = supabaseAdmin();
    const { data } = await db.from("doc_cartao_faturas").select("*").order("ano", { ascending: false }).order("mes", { ascending: false }).order("cartao");
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
    const ano = Number(b.ano), mes = Number(b.mes);
    const cartao = String(b.cartao || "").trim();
    const storage_path = String(b.storage_path || "");
    if (!ano || ano < 2000 || mes < 1 || mes > 12 || !cartao || !storage_path) return jsonErr(400, "Dados incompletos (ano, mês, cartão e arquivo).");
    const valor = b.valor != null && b.valor !== "" ? Number(b.valor) : null;
    const db = supabaseAdmin();
    const { data, error } = await db.from("doc_cartao_faturas").insert({
      ano, mes, cartao, storage_path,
      valor: valor != null && !isNaN(valor) ? valor : null,
      vencimento: b.vencimento || null,
      nome_arquivo: b.nome_arquivo || null, observacao: b.observacao || null, criado_por: admin.email,
    }).select().single();
    if (error) return jsonErr(500, error.message);
    await registrarAcao(db, { req: request, admin }, { acao: "criar", entidade: "doc_cartao_faturas", registro_id: data?.id ?? null, descricao: `Anexou fatura ${cartao} ${String(mes).padStart(2, "0")}/${ano}`, dados: { ano, mes, cartao } }).catch(() => {});
    return jsonOk(data, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
