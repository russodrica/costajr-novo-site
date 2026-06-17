import type { APIRoute } from "astro";
import { requireAdminCookie, temPerfil, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";

export const prerender = false;

const PERFIS = ["admin", "financeiro", "juridico"];
const EXT_OK = ["pdf", "doc", "docx", "xls", "xlsx", "jpg", "jpeg", "png", "webp"];

// POST /api/admin/doc-empresa/[id]/upload-url
// Body: { nome: string, content_type?: string }
// Devolve URL assinada p/ o browser subir o arquivo DIRETO ao bucket privado
// "doc-empresa", sem passar pelo limite de body da Vercel (4.5 MB).
export const POST: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const docId = params.id!;
    const db = supabaseAdmin();

    const { data: doc } = await db.from("doc_empresa").select("id").eq("id", docId).maybeSingle();
    if (!doc) return jsonErr(404, "Documento não encontrado.");

    const body = await request.json();
    const nomeOriginal = String(body.nome || "arquivo").slice(0, 150);
    const ext = (nomeOriginal.includes(".") ? nomeOriginal.split(".").pop() : "")
      ?.toLowerCase().replace(/[^a-z0-9]/g, "") || "pdf";
    if (!EXT_OK.includes(ext)) return jsonErr(400, `Extensão .${ext} não permitida.`);

    const ct = String(body.content_type || "application/octet-stream");
    const slug = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const path = `${docId}/${slug}.${ext}`;

    const { data, error } = await db.storage.from("doc-empresa").createSignedUploadUrl(path);
    if (error) return jsonErr(500, error.message);

    return jsonOk({ signed_url: data.signedUrl, path, nome_original: nomeOriginal, content_type: ct });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
