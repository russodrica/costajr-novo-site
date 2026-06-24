import type { APIRoute } from "astro";
import { requireAdminCookie, temPerfil, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao, excluirComLixeira } from "../../../../../lib/auditoria";

export const prerender = false;
const PERFIS = ["admin", "financeiro", "juridico"];
const TIPOS = ["emprestimo", "financiamento"];
const STATUS = ["ativo", "quitado", "renegociado"];
const num = (v: any) => (v != null && v !== "" && !isNaN(Number(v)) ? Number(v) : null);

// GET (sem subrota) → redireciona p/ o contrato (URL assinada), se houver.
export const GET: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const db = supabaseAdmin();
    const { data: row } = await db.from("doc_emprestimos").select("storage_path").eq("id", params.id!).maybeSingle();
    if (!row?.storage_path) return jsonErr(404, "Sem contrato anexado.");
    const { data, error } = await db.storage.from("doc-empresa").createSignedUrl(row.storage_path, 600);
    if (error || !data?.signedUrl) return jsonErr(500, error?.message || "Falha ao gerar link.");
    return new Response(null, { status: 302, headers: { Location: data.signedUrl } });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const b = await request.json();
    const upd: Record<string, any> = {};
    if (b.descricao != null) upd.descricao = String(b.descricao).trim();
    if (b.tipo != null && TIPOS.includes(b.tipo)) upd.tipo = b.tipo;
    if (b.status != null) { if (!STATUS.includes(b.status)) return jsonErr(400, "Status inválido."); upd.status = b.status; }
    if (b.banco !== undefined) upd.banco = b.banco ? String(b.banco).trim() : null;
    if (b.valor_total !== undefined) upd.valor_total = num(b.valor_total);
    if (b.num_parcelas !== undefined) upd.num_parcelas = num(b.num_parcelas);
    if (b.valor_parcela !== undefined) upd.valor_parcela = num(b.valor_parcela);
    if (b.data_contratacao !== undefined) upd.data_contratacao = b.data_contratacao || null;
    if (b.data_primeira_parcela !== undefined) upd.data_primeira_parcela = b.data_primeira_parcela || null;
    if (b.observacao !== undefined) upd.observacao = b.observacao || null;
    // anexo do contrato (após upload-url + PUT)
    if (b.storage_path !== undefined) { upd.storage_path = b.storage_path || null; upd.nome_arquivo = b.nome_arquivo || null; }
    if (!Object.keys(upd).length) return jsonErr(400, "Nada a atualizar.");
    const db = supabaseAdmin();
    const { data, error } = await db.from("doc_emprestimos").update(upd).eq("id", params.id!).select().single();
    if (error) return jsonErr(500, error.message);
    await registrarAcao(db, { req: request, admin }, { acao: "editar", entidade: "doc_emprestimos", registro_id: params.id!, descricao: `Editou ${data?.tipo || "empréstimo"}: ${data?.descricao || ""}` }).catch(() => {});
    return jsonOk(data);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const db = supabaseAdmin();
    const { data: row } = await db.from("doc_emprestimos").select("*").eq("id", params.id!).maybeSingle();
    if (!row) return jsonErr(404, "Não encontrado.");
    if (row.storage_path) await db.storage.from("doc-empresa").remove([row.storage_path]).catch(() => {});
    await excluirComLixeira(db, { req: request, admin }, {
      tabela: "doc_emprestimos", idCol: "id", id: params.id!,
      descricao: `Excluiu ${row.tipo}: ${row.descricao}`,
    });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
