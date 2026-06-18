import type { APIRoute } from "astro";
import { requireAdminCookie, temPerfil, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";
import { excluirComLixeira, registrarAcao } from "../../../../lib/auditoria";

export const prerender = false;

const PERFIS = ["admin", "financeiro", "juridico"];
const CAMPOS = ["nome", "categoria", "grupo", "periodicidade", "validade", "validade_na", "site", "observacoes", "arquivado", "valor_mensal"];

// PATCH /api/admin/doc-empresa/[id] → edita / arquiva / marca "não aplicável"
export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const id = params.id!;
    const body = await request.json();
    const db = supabaseAdmin();

    const { data: doc } = await db.from("doc_empresa").select("*").eq("id", id).maybeSingle();
    if (!doc) return jsonErr(404, "Documento não encontrado.");

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const c of CAMPOS) {
      if (body[c] === undefined) continue;
      // "grupo" só vai no PATCH se tiver valor (coluna pode não existir antes da migration 068)
      if (c === "grupo" && (body[c] === null || body[c] === "")) continue;
      // "valor_mensal" só vai no PATCH se for número válido (requer migration 069)
      if (c === "valor_mensal") {
        if (body[c] === null || body[c] === "") continue;
        const num = parseFloat(String(body[c]));
        if (isNaN(num)) continue;
        patch[c] = num; continue;
      }
      if (c === "validade_na" || c === "arquivado") patch[c] = !!body[c];
      else patch[c] = body[c] === "" ? null : body[c];
    }
    if (patch.nome !== undefined && !String(patch.nome).trim()) return jsonErr(400, "O nome não pode ficar vazio.");
    // "Não aplicável" e validade são mutuamente exclusivos.
    if (patch.validade_na === true) patch.validade = null;
    if (patch.validade) patch.validade_na = false;

    let { data, error } = await db.from("doc_empresa").update(patch).eq("id", id).select().single();
    // Se a migration 068/069 ainda não foi rodada, as colunas grupo/valor_mensal não existem.
    // Nesse caso, retenta sem elas para não bloquear o usuário.
    if (error && /could not find.*column.*(grupo|valor_mensal)/i.test(error.message)) {
      delete patch.grupo;
      delete patch.valor_mensal;
      const r2 = await db.from("doc_empresa").update(patch).eq("id", id).select().single();
      data = r2.data;
      error = r2.error;
    }
    if (error) return jsonErr(400, error.message);

    const acaoTxt = body.arquivado === true ? `Arquivou o documento "${doc.nome}"`
      : body.arquivado === false ? `Reativou o documento "${doc.nome}"`
      : `Editou o documento "${doc.nome}"`;
    await registrarAcao(db, { req: request, admin }, {
      acao: "editar", entidade: "doc_empresa", registro_id: id, descricao: acaoTxt, dados: patch,
    });
    return jsonOk(data);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// DELETE /api/admin/doc-empresa/[id] → exclui (vai para a lixeira por 30 dias).
// Os anexos (linhas) seguem o documento via FK on delete cascade; os arquivos no
// storage privado permanecem (não há perda de bytes) — convenção do projeto.
export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const id = params.id!;
    const db = supabaseAdmin();
    const { data: doc } = await db
      .from("doc_empresa")
      .select("nome, doc_empresa_arquivos(id,nome,storage_path)")
      .eq("id", id)
      .maybeSingle();
    const r = await excluirComLixeira(db, { req: request, admin }, {
      tabela: "doc_empresa", id, entidade: "doc_empresa",
      descricao: doc ? `Excluiu o documento "${doc.nome}"` : `Excluiu o documento ${id}`,
    });
    if (!r.ok) return jsonErr(400, r.error || "Falha ao excluir");
    // registra os anexos que existiam (rastreio — arquivos permanecem no storage)
    if (doc?.doc_empresa_arquivos?.length) {
      await registrarAcao(db, { req: request, admin }, {
        acao: "excluir", entidade: "doc_empresa_arquivos", registro_id: id,
        descricao: `Anexos do documento excluído "${doc.nome}"`, dados: doc.doc_empresa_arquivos,
      });
    }
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
