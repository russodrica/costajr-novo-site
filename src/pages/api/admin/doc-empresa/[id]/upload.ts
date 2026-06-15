import type { APIRoute } from "astro";
import { requireAdminCookie, temPerfil, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";

export const prerender = false;

const PERFIS = ["admin", "financeiro", "juridico"];
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const EXT_POR_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

// POST /api/admin/doc-empresa/[id]/upload — multipart: arquivo. Sobe ao bucket
// PRIVADO "doc-empresa" e registra o anexo em doc_empresa_arquivos.
export const POST: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const docId = params.id!;
    const db = supabaseAdmin();

    const { data: doc } = await db.from("doc_empresa").select("id, nome").eq("id", docId).maybeSingle();
    if (!doc) return jsonErr(404, "Documento não encontrado.");

    const form = await request.formData().catch(() => null);
    if (!form) return jsonErr(400, "Envie o formulário com o arquivo (multipart/form-data).");
    const arquivo = form.get("arquivo");
    if (!(arquivo instanceof File) || arquivo.size === 0) return jsonErr(400, "Selecione um arquivo.");
    if (arquivo.size > MAX_BYTES) return jsonErr(400, "Arquivo muito grande — o limite é 25 MB.");

    const ct = arquivo.type || "application/octet-stream";
    const ok = ct === "application/pdf" || ct.startsWith("image/") || ct.includes("word") || ct.includes("officedocument") || ct.includes("excel") || ct.includes("spreadsheet");
    if (!ok) return jsonErr(400, "Formato não aceito — envie PDF, DOC/DOCX, XLS/XLSX ou imagem.");

    const nomeOriginal = (arquivo.name || "arquivo").slice(0, 150);
    let ext = (nomeOriginal.includes(".") ? nomeOriginal.split(".").pop() : "")?.toLowerCase().replace(/[^a-z0-9]/g, "") || "";
    if (!ext || ext.length > 5) ext = EXT_POR_MIME[ct] || "pdf";

    const storagePath = `${docId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const bytes = await arquivo.arrayBuffer();
    const { error: errUp } = await db.storage.from("doc-empresa").upload(storagePath, bytes, { contentType: ct, upsert: false });
    if (errUp) return jsonErr(500, `Falha no envio do arquivo: ${errUp.message}`);

    const { data, error } = await db
      .from("doc_empresa_arquivos")
      .insert({ doc_id: docId, nome: nomeOriginal, storage_path: storagePath, criado_por: admin.email })
      .select()
      .single();
    if (error) {
      await db.storage.from("doc-empresa").remove([storagePath]).catch(() => {}); // rollback do arquivo
      return jsonErr(400, error.message);
    }
    await registrarAcao(db, { req: request, admin }, {
      acao: "criar", entidade: "doc_empresa_arquivos", registro_id: data.id,
      descricao: `Anexou "${nomeOriginal}" ao documento "${doc.nome}"`, dados: { doc_id: docId },
    });
    return jsonOk(data, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
