import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { requireAdminCookie, jsonOk, jsonErr } from "~/lib/auth";

export const prerender = false;

// POST { nome, content_type } → URL assinada para o navegador subir o arquivo
// direto ao bucket `portal` (sem passar pelo limite de body da Vercel).
export const POST: APIRoute = async ({ request }) => {
  try {
    await requireAdminCookie(request);
    const { nome, content_type } = await request.json();
    if (!nome) return jsonErr(400, "Informe o nome do arquivo.");

    const ext = String(nome).split(".").pop()?.toLowerCase() || "bin";
    const permitidas = ["pdf", "png", "jpg", "jpeg", "webp", "gif", "mp4", "webm", "xlsx", "docx", "pptx", "zip"];
    if (!permitidas.includes(ext)) return jsonErr(400, `Extensão .${ext} não permitida.`);

    const slug = String(nome)
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9-_]+/g, "-").slice(0, 60).toLowerCase();
    const path = `conteudo/${Date.now()}-${slug}.${ext}`;

    const sb = supabaseAdmin();
    const { data, error } = await sb.storage.from("portal").createSignedUploadUrl(path);
    if (error) return jsonErr(500, error.message);

    const publicUrl = `${import.meta.env.PUBLIC_SUPABASE_URL}/storage/v1/object/public/portal/${path}`;
    return jsonOk({ signed_url: data.signedUrl, token: data.token, path, public_url: publicUrl, content_type: content_type || "application/octet-stream" });
  } catch {
    return jsonErr(401, "Não autenticado.");
  }
};
