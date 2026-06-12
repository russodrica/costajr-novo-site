import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { jsonOk, jsonErr } from "~/lib/auth";

export const prerender = false;

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const TIPOS_VALIDOS = ["rg", "cpf", "cnh", "ctps", "comprovante_residencia", "foto", "aso", "outro"];
const EXT_POR_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/pdf": "pdf",
};

// POST /api/admissao/[token]/enviar — endpoint PÚBLICO (candidato envia documento).
// multipart/form-data: tipo + arquivo. Upload vai pro bucket PRIVADO "rh" (LGPD) —
// nunca gera URL pública; o RH acessa via URL assinada no admin.
export const POST: APIRoute = async ({ request, params }) => {
  try {
    const db = supabaseAdmin();
    const { data: adm } = await db
      .from("rh_admissoes")
      .select("id, status")
      .eq("token", params.token!)
      .maybeSingle();
    if (!adm) return jsonErr(404, "Link de admissão não encontrado");
    if (!["aguardando", "docs_enviados"].includes(adm.status)) {
      return jsonErr(400, "Esta admissão já foi finalizada — fale com o RH se precisar enviar algo");
    }

    const form = await request.formData().catch(() => null);
    if (!form) return jsonErr(400, "Envie o formulário com o arquivo (multipart/form-data)");

    const tipo = String(form.get("tipo") || "").trim();
    if (!TIPOS_VALIDOS.includes(tipo)) return jsonErr(400, "Tipo de documento inválido");

    const arquivo = form.get("arquivo");
    if (!(arquivo instanceof File) || arquivo.size === 0) return jsonErr(400, "Selecione um arquivo");
    if (arquivo.size > MAX_BYTES) return jsonErr(400, "Arquivo muito grande — o limite é 10 MB");

    const contentType = arquivo.type || "";
    if (!contentType.startsWith("image/") && contentType !== "application/pdf") {
      return jsonErr(400, "Formato não aceito — envie uma foto (imagem) ou um PDF");
    }

    // extensão: do nome original, senão do content-type
    const nomeOriginal = (arquivo.name || "").slice(0, 150);
    let ext = (nomeOriginal.includes(".") ? nomeOriginal.split(".").pop() : "")?.toLowerCase().replace(/[^a-z0-9]/g, "") || "";
    if (!ext || ext.length > 5) ext = EXT_POR_MIME[contentType] || (contentType.startsWith("image/") ? "jpg" : "pdf");

    const storagePath = `admissoes/${adm.id}/${tipo}-${Date.now()}.${ext}`;
    const bytes = await arquivo.arrayBuffer();
    const { error: errUp } = await db.storage.from("rh").upload(storagePath, bytes, {
      contentType,
      upsert: false,
    });
    if (errUp) return jsonErr(500, `Falha no envio do arquivo: ${errUp.message}`);

    const { data: doc, error: errDoc } = await db
      .from("rh_admissoes_docs")
      .insert({
        admissao_id: adm.id,
        tipo,
        nome_arquivo: nomeOriginal || `${tipo}.${ext}`,
        storage_path: storagePath,
      })
      .select("id, tipo, nome_arquivo, created_at")
      .single();
    if (errDoc) return jsonErr(500, errDoc.message);

    await db
      .from("rh_admissoes")
      .update({ status: "docs_enviados", updated_at: new Date().toISOString() })
      .eq("id", adm.id);

    return jsonOk(doc, 201);
  } catch (e: any) {
    return jsonErr(500, e.message);
  }
};
