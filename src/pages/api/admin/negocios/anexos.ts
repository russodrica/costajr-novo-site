import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";
import { registrarAcao } from "../../../../lib/auditoria";
import { bloqueioSeSoLeitura, bloqueioSeSemLeitura } from "../../../../lib/permissoes";
import {
  BUCKET_NEGOCIOS, storageNegocios, garantirBucketNegocios, TIPOS_ANEXO_VALORES,
} from "../../../../lib/negocios";

export const prerender = false;

const MODULO = "negocios";
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const EXT_POR_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic",
};

// GET /api/admin/negocios/anexos?imovel_id=... — lista fotos e documentos do card.
export const GET: APIRoute = async ({ request, url }) => {
  try {
    const admin = await requireAdminCookie(request);
    const ro = await bloqueioSeSemLeitura(admin, MODULO); if (ro) return ro;
    const imovelId = url.searchParams.get("imovel_id") || "";
    if (!imovelId) return jsonErr(400, "Informe ?imovel_id=");
    const db = supabaseAdmin();
    const { data, error } = await db.from("negocios_anexos").select("*").eq("imovel_id", imovelId).order("created_at");
    if (error) return jsonErr(400, error.message);
    return jsonOk(data || []);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// POST /api/admin/negocios/anexos — multipart: arquivo + imovel_id, especie, titulo, tipo.
// especie = "foto" (galeria/catálogo) ou "documento" (matrícula, IPTU, contrato...).
// Tudo vai para o bucket PRIVADO; a tela lê pelo endpoint autenticado /anexos/[id].
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const bl = await bloqueioSeSoLeitura(admin, MODULO); if (bl) return bl;
    const db = supabaseAdmin();

    const form = await request.formData().catch(() => null);
    if (!form) return jsonErr(400, "Envie o formulário com o arquivo (multipart/form-data).");

    const imovel_id = String(form.get("imovel_id") || "").trim();
    if (!imovel_id) return jsonErr(400, "Cadastro não informado.");
    const { data: imovel } = await db.from("negocios_imoveis").select("id, titulo, capa_anexo_id").eq("id", imovel_id).maybeSingle();
    if (!imovel) return jsonErr(404, "Cadastro não encontrado.");

    const especie = String(form.get("especie") || "documento") === "foto" ? "foto" : "documento";
    const tipo = String(form.get("tipo") || "outro").trim();
    if (especie === "documento" && !TIPOS_ANEXO_VALORES.includes(tipo)) return jsonErr(400, "Tipo de documento inválido.");

    const arquivo = form.get("arquivo");
    if (!(arquivo instanceof File) || arquivo.size === 0) return jsonErr(400, "Selecione um arquivo.");
    if (arquivo.size > MAX_BYTES) return jsonErr(400, "Arquivo muito grande — o limite é 25 MB.");

    const ct = arquivo.type || "application/octet-stream";
    if (especie === "foto" && !ct.startsWith("image/")) return jsonErr(400, "Para a galeria, envie uma imagem.");
    if (especie === "documento") {
      const ok = ct === "application/pdf" || ct.startsWith("image/") || ct.includes("word") || ct.includes("excel") || ct.includes("officedocument");
      if (!ok) return jsonErr(400, "Formato não aceito — envie PDF, Word, Excel ou imagem.");
    }

    const nomeOriginal = (arquivo.name || "").slice(0, 150);
    let ext = (nomeOriginal.includes(".") ? nomeOriginal.split(".").pop() : "")?.toLowerCase().replace(/[^a-z0-9]/g, "") || "";
    if (!ext || ext.length > 5) ext = EXT_POR_MIME[ct] || "bin";

    await garantirBucketNegocios();
    const storagePath = `${especie === "foto" ? "fotos" : "docs"}/${imovel_id}/${Date.now()}.${ext}`;
    const bytes = await arquivo.arrayBuffer();
    const { error: errUp } = await storageNegocios().storage
      .from(BUCKET_NEGOCIOS).upload(storagePath, bytes, { contentType: ct, upsert: false });
    if (errUp) return jsonErr(500, `Falha no envio do arquivo: ${errUp.message}`);

    const titulo = String(form.get("titulo") || "").trim() || nomeOriginal || (especie === "foto" ? "Foto" : "Documento");
    const row = {
      imovel_id, especie, titulo, tipo: especie === "foto" ? null : tipo,
      storage_path: storagePath, nome_arquivo: nomeOriginal, content_type: ct,
      tamanho: arquivo.size, criado_por: admin.email,
    };
    const { data, error } = await db.from("negocios_anexos").insert(row).select().single();
    if (error) {
      // rollback do arquivo para não deixar lixo pago no storage
      try { await storageNegocios().storage.from(BUCKET_NEGOCIOS).remove([storagePath]); } catch { /* ignore */ }
      return jsonErr(400, error.message);
    }

    // primeira foto vira a capa do catálogo automaticamente
    let virouCapa = false;
    if (especie === "foto" && !imovel.capa_anexo_id) {
      await db.from("negocios_imoveis").update({ capa_anexo_id: data.id, updated_at: new Date().toISOString() }).eq("id", imovel_id);
      virouCapa = true;
    }

    await registrarAcao(db, { req: request, admin }, {
      acao: "criar", entidade: "negocios_anexos", registro_id: data.id,
      descricao: `Anexou ${especie === "foto" ? "foto" : "documento"} "${titulo}" em ${imovel.titulo}`,
      dados: { imovel_id, especie, tipo },
    });
    return jsonOk({ ...data, virou_capa: virouCapa }, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
