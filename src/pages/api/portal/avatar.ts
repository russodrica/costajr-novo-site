import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { requireAdmin, jsonOk, jsonErr } from "~/lib/auth";

export const prerender = false;

// POST /api/portal/avatar — colaborador atualiza a própria foto.
// body: { imagem_base64, content_type }
export const POST: APIRoute = async ({ request }) => {
  try {
    const claims = await requireAdmin(request);
    const { imagem_base64, content_type } = await request.json();
    if (!imagem_base64 || !String(content_type || "").startsWith("image/")) {
      return jsonErr(400, "Envie uma imagem válida.");
    }
    const buf = Buffer.from(imagem_base64, "base64");
    if (buf.length > 5 * 1024 * 1024) return jsonErr(400, "Imagem muito grande (máx. 5MB).");

    const ext = content_type === "image/png" ? "png" : content_type === "image/webp" ? "webp" : "jpg";
    const path = `avatares/${claims.sub}.${ext}`;
    const sb = supabaseAdmin();
    const { error: eUp } = await sb.storage.from("portal").upload(path, buf, { contentType: content_type, upsert: true });
    if (eUp) return jsonErr(500, eUp.message);

    const url = `${import.meta.env.PUBLIC_SUPABASE_URL}/storage/v1/object/public/portal/${path}?v=${Date.now()}`;
    const { data, error } = await sb.from("portal_profiles").update({ avatar_url: url }).eq("id", claims.sub).select("id, avatar_url").single();
    if (error) return jsonErr(400, error.message);
    return jsonOk(data);
  } catch {
    return jsonErr(401, "Não autenticado.");
  }
};
