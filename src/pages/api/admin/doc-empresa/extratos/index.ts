import type { APIRoute } from "astro";
import { requireAdminCookie, temPerfil, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";
import { bloqueioSeSemLeitura } from "../../../../../lib/permissoes";

export const prerender = false;
const PERFIS = ["admin", "financeiro", "juridico"];

// GET → lista todos os extratos. POST → registra um extrato já enviado ao bucket.
export const GET: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const ro = await bloqueioSeSemLeitura(admin, "doc-bancarios"); if (ro) return ro;
    const db = supabaseAdmin();
    const { data } = await db.from("doc_extratos_bancarios").select("*").order("ano", { ascending: false }).order("mes", { ascending: false }).order("banco");
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
    const banco = String(b.banco || "").trim();
    const storage_path = String(b.storage_path || "");
    if (!ano || ano < 2000 || mes < 1 || mes > 12 || !banco || !storage_path) return jsonErr(400, "Dados incompletos (ano, mês, banco e arquivo).");
    const db = supabaseAdmin();
    const { data, error } = await db.from("doc_extratos_bancarios").insert({
      ano, mes, banco, storage_path, nome_arquivo: b.nome_arquivo || null, observacao: b.observacao || null, criado_por: admin.email,
    }).select().single();
    if (error) return jsonErr(500, error.message);
    await registrarAcao(db, { req: request, admin }, { acao: "criar", entidade: "doc_extratos_bancarios", registro_id: data?.id ?? null, descricao: `Anexou extrato ${banco} ${String(mes).padStart(2, "0")}/${ano}`, dados: { ano, mes, banco } }).catch(() => {});
    return jsonOk(data, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
