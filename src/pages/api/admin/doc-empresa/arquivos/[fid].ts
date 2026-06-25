import type { APIRoute } from "astro";
import { requireAdminCookie, temPerfil, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";

export const prerender = false;

const PERFIS = ["admin", "financeiro", "juridico", "comercial"]; // comercial = leitura (middleware barra mutação)

// GET /api/admin/doc-empresa/arquivos/[fid] → redireciona para URL assinada (10 min).
// Bucket PRIVADO — documentos sensíveis (LGPD).
export const GET: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const db = supabaseAdmin();
    const { data: arq } = await db.from("doc_empresa_arquivos").select("storage_path").eq("id", params.fid!).maybeSingle();
    if (!arq?.storage_path) return jsonErr(404, "Arquivo não encontrado");
    const { data: assinada, error } = await db.storage.from("doc-empresa").createSignedUrl(arq.storage_path, 600);
    if (error || !assinada?.signedUrl) return jsonErr(500, error?.message || "Falha ao assinar URL");
    return new Response(null, { status: 302, headers: { location: assinada.signedUrl, "cache-control": "no-store" } });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// PATCH /api/admin/doc-empresa/arquivos/[fid] → arquiva/reativa uma VERSÃO do documento.
// Arquivar = mandar a versão antiga p/ o histórico (some do painel; só o vigente aparece).
// Reativar = trazer de volta. Não apaga nada — só alterna o flag (recuperável).
export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const b = await request.json().catch(() => ({}));
    const arquivado = !!b.arquivado;
    const db = supabaseAdmin();
    const { data: arq } = await db.from("doc_empresa_arquivos").select("id, nome").eq("id", params.fid!).maybeSingle();
    if (!arq) return jsonErr(404, "Arquivo não encontrado");
    const { error } = await db.from("doc_empresa_arquivos")
      .update({ arquivado, arquivado_em: arquivado ? new Date().toISOString() : null })
      .eq("id", params.fid!);
    if (error) return jsonErr(400, error.message);
    await registrarAcao(db, { req: request, admin }, {
      acao: "editar", entidade: "doc_empresa_arquivos", registro_id: params.fid!,
      descricao: `${arquivado ? "Arquivou" : "Reativou"} a versão "${(arq as any).nome}"`,
    }).catch(() => {});
    return jsonOk({ ok: true, arquivado });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// DELETE /api/admin/doc-empresa/arquivos/[fid] → remove anexo (linha + arquivo do storage).
// Anexo de storage: só registrarAcao (sem lixeira) — convenção do projeto.
export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const db = supabaseAdmin();
    const { data: arq } = await db.from("doc_empresa_arquivos").select("*").eq("id", params.fid!).maybeSingle();
    if (!arq) return jsonErr(404, "Arquivo não encontrado");
    const { error } = await db.from("doc_empresa_arquivos").delete().eq("id", params.fid!);
    if (error) return jsonErr(400, error.message);
    await db.storage.from("doc-empresa").remove([arq.storage_path]).catch(() => {});
    await registrarAcao(db, { req: request, admin }, {
      acao: "excluir", entidade: "doc_empresa_arquivos", registro_id: params.fid!,
      descricao: `Removeu o anexo "${arq.nome}"`, dados: arq,
    });
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
