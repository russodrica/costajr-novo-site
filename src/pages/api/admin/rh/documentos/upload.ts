import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";

export const prerender = false;

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB
const TIPOS_DOC = ["contrato", "aso", "ficha_epi", "advertencia", "atestado", "certificado", "cnh", "outro"];
const EXT_POR_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

// POST /api/admin/rh/documentos/upload — multipart: arquivo + colaborador_id, titulo,
// tipo, validade, validade_na, observacoes. Sobe o ARQUIVO ao bucket PRIVADO "rh"
// (LGPD) e cria a linha em rh_documentos com storage_path.
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const db = supabaseAdmin();
    const form = await request.formData().catch(() => null);
    if (!form) return jsonErr(400, "Envie o formulário com o arquivo (multipart/form-data).");

    const colaborador_id = String(form.get("colaborador_id") || "").trim();
    const titulo = String(form.get("titulo") || "").trim();
    if (!colaborador_id) return jsonErr(400, "Selecione o colaborador.");
    if (!titulo) return jsonErr(400, "Informe o título do documento.");
    const tipo = String(form.get("tipo") || "outro").trim();
    if (tipo && !TIPOS_DOC.includes(tipo)) return jsonErr(400, "Tipo de documento inválido.");

    const arquivo = form.get("arquivo");
    if (!(arquivo instanceof File) || arquivo.size === 0) return jsonErr(400, "Selecione um arquivo.");
    if (arquivo.size > MAX_BYTES) return jsonErr(400, "Arquivo muito grande — o limite é 15 MB.");
    const ct = arquivo.type || "application/octet-stream";
    const ok = ct === "application/pdf" || ct.startsWith("image/") || ct.includes("word") || ct.includes("officedocument");
    if (!ok) return jsonErr(400, "Formato não aceito — envie PDF, DOC/DOCX ou imagem.");

    const nomeOriginal = (arquivo.name || "").slice(0, 150);
    let ext = (nomeOriginal.includes(".") ? nomeOriginal.split(".").pop() : "")?.toLowerCase().replace(/[^a-z0-9]/g, "") || "";
    if (!ext || ext.length > 5) ext = EXT_POR_MIME[ct] || "pdf";

    const storagePath = `documentos/${colaborador_id}/${Date.now()}.${ext}`;
    const bytes = await arquivo.arrayBuffer();
    const { error: errUp } = await db.storage.from("rh").upload(storagePath, bytes, { contentType: ct, upsert: false });
    if (errUp) return jsonErr(500, `Falha no envio do arquivo: ${errUp.message}`);

    const validadeNA = String(form.get("validade_na") || "") === "true" || String(form.get("validade_na") || "") === "on";
    const validade = validadeNA ? null : (String(form.get("validade") || "").trim() || null);
    const observacoes = String(form.get("observacoes") || "").trim() || null;

    const row: Record<string, unknown> = {
      colaborador_id, titulo, tipo: tipo || "outro", storage_path: storagePath,
      validade, validade_na: validadeNA, observacoes, criado_por: admin.email,
    };
    const { data, error } = await db.from("rh_documentos").insert(row).select().single();
    if (error) {
      await db.storage.from("rh").remove([storagePath]).catch(() => {}); // rollback do arquivo
      return jsonErr(400, error.message);
    }
    await registrarAcao(db, { req: request, admin }, { acao: "criar", entidade: "rh_documentos", registro_id: data.id, descricao: `Anexou documento "${titulo}" (arquivo)`, dados: { tipo, validade } });
    return jsonOk(data, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
