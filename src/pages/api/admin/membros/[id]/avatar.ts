import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";

export const prerender = false;

// POST /api/admin/membros/[id]/avatar — admin define a foto de um membro.
// body: { imagem_base64, content_type }
export const POST: APIRoute = async ({ request, params }) => {
  try {
    await requireAdminCookie(request);
    const { imagem_base64, content_type } = await request.json();
    // Allow-list estrita: bloqueia image/svg+xml (XSS armazenado no bucket público) e outros.
    if (!imagem_base64 || !["image/png", "image/jpeg", "image/webp"].includes(String(content_type || ""))) {
      return jsonErr(400, "Envie uma imagem PNG, JPG ou WEBP.");
    }
    const buf = Buffer.from(imagem_base64, "base64");
    if (buf.length > 5 * 1024 * 1024) return jsonErr(400, "Imagem muito grande (máx. 5MB).");

    const ext = content_type === "image/png" ? "png" : content_type === "image/webp" ? "webp" : "jpg";
    const path = `avatares/${params.id}.${ext}`;
    const db = supabaseAdmin();
    const { error: eUp } = await db.storage.from("portal").upload(path, buf, { contentType: content_type, upsert: true });
    if (eUp) return jsonErr(500, eUp.message);

    const url = `${import.meta.env.PUBLIC_SUPABASE_URL}/storage/v1/object/public/portal/${path}?v=${Date.now()}`;
    const { data, error } = await db.from("portal_profiles").update({ avatar_url: url }).eq("id", params.id!).select("id, avatar_url").single();
    if (error) return jsonErr(400, error.message);
    return jsonOk(data);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
