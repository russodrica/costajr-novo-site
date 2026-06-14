import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../../lib/supabase";
import { registrarAcao } from "../../../../../../lib/auditoria";

export const prerender = false;

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const EXT_POR_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "image/jpeg": "jpg",
  "image/png": "png",
};

// POST — sobe o currículo (multipart: arquivo) para o bucket PRIVADO "rh".
// GET  — devolve URL assinada (10 min) para baixar.
// DELETE — remove o arquivo e limpa as colunas.
export const POST: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const db = supabaseAdmin();
    const id = params.id!;
    const { data: cand } = await db.from("rh_candidatos").select("id, nome, curriculo_path").eq("id", id).maybeSingle();
    if (!cand) return jsonErr(404, "Candidato não encontrado");

    const form = await request.formData().catch(() => null);
    if (!form) return jsonErr(400, "Envie o arquivo (multipart/form-data)");
    const arquivo = form.get("arquivo");
    if (!(arquivo instanceof File) || arquivo.size === 0) return jsonErr(400, "Selecione um arquivo");
    if (arquivo.size > MAX_BYTES) return jsonErr(400, "Arquivo muito grande — o limite é 10 MB");

    const contentType = arquivo.type || "application/octet-stream";
    const okTipo = contentType === "application/pdf" || contentType.startsWith("image/") || contentType.includes("word") || contentType.includes("officedocument");
    if (!okTipo) return jsonErr(400, "Formato não aceito — envie PDF, DOC/DOCX ou imagem");

    const nomeOriginal = (arquivo.name || "").slice(0, 150);
    let ext = (nomeOriginal.includes(".") ? nomeOriginal.split(".").pop() : "")?.toLowerCase().replace(/[^a-z0-9]/g, "") || "";
    if (!ext || ext.length > 5) ext = EXT_POR_MIME[contentType] || "pdf";

    // remove o anterior (se houver) para não acumular lixo no bucket
    if (cand.curriculo_path) await db.storage.from("rh").remove([cand.curriculo_path]).catch(() => {});

    const storagePath = `candidatos/${id}/curriculo-${Date.now()}.${ext}`;
    const bytes = await arquivo.arrayBuffer();
    const { error: errUp } = await db.storage.from("rh").upload(storagePath, bytes, { contentType, upsert: false });
    if (errUp) return jsonErr(500, `Falha no envio do arquivo: ${errUp.message}`);

    const { data, error } = await db.from("rh_candidatos")
      .update({ curriculo_path: storagePath, curriculo_nome: nomeOriginal || `curriculo.${ext}`, updated_at: new Date().toISOString() })
      .eq("id", id).select().single();
    if (error) return jsonErr(400, error.message);
    await registrarAcao(db, { req: request, admin }, { acao: "editar", entidade: "rh_candidatos", registro_id: id, descricao: `Anexou currículo de "${cand.nome}"`, dados: { curriculo_nome: data.curriculo_nome } });
    return jsonOk(data, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

export const GET: APIRoute = async ({ request, params }) => {
  try {
    await requireAdminCookie(request);
    const db = supabaseAdmin();
    const { data: cand } = await db.from("rh_candidatos").select("curriculo_path").eq("id", params.id!).maybeSingle();
    if (!cand || !cand.curriculo_path) return jsonErr(404, "Este candidato não tem currículo anexado");
    const { data, error } = await db.storage.from("rh").createSignedUrl(cand.curriculo_path, 600);
    if (error || !data) return jsonErr(500, error?.message || "Falha ao gerar link");
    return jsonOk({ url: data.signedUrl });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const db = supabaseAdmin();
    const id = params.id!;
    const { data: cand } = await db.from("rh_candidatos").select("nome, curriculo_path").eq("id", id).maybeSingle();
    if (!cand) return jsonErr(404, "Candidato não encontrado");
    if (cand.curriculo_path) await db.storage.from("rh").remove([cand.curriculo_path]).catch(() => {});
    await db.from("rh_candidatos").update({ curriculo_path: null, curriculo_nome: null, updated_at: new Date().toISOString() }).eq("id", id);
    await registrarAcao(db, { req: request, admin }, { acao: "editar", entidade: "rh_candidatos", registro_id: id, descricao: `Removeu currículo de "${cand.nome}"`, dados: {} });
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
