import type { APIRoute } from "astro";
import { requireCliente, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";

export const prerender = false;

// POST /api/manut/cliente/materiais/[id]/comprovante
// Body JSON: { mime, data_base64, filename? }
// Salva no bucket "materiais" em {id}/comprovante-{ts}.{ext} e retorna { url }.
export const POST: APIRoute = async ({ request, params }) => {
  try {
    const claims = await requireCliente(request);
    const id = params.id!;
    const db = supabaseAdmin();

    const { data: mat } = await db
      .from("manut_materiais")
      .select("id,cliente_id")
      .eq("id", id)
      .single();
    if (!mat) return jsonErr(404, "Material não encontrado");
    if (mat.cliente_id !== claims.sub) return jsonErr(403, "Material não pertence a você");

    const { mime, data_base64 } = await request.json();
    const tiposOk = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (!tiposOk.includes(mime)) return jsonErr(400, "Tipo de arquivo não suportado (use JPG, PNG, WEBP ou PDF)");
    if (!data_base64 || typeof data_base64 !== "string") return jsonErr(400, "data_base64 ausente");
    if (data_base64.length > 14 * 1024 * 1024) return jsonErr(413, "Arquivo grande demais (máx 10MB)");

    const bin = atob(data_base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

    const ext = mime === "application/pdf" ? "pdf"
              : mime === "image/png" ? "png"
              : mime === "image/webp" ? "webp" : "jpg";
    const ts = Date.now();
    const path = `${id}/comprovante-${ts}.${ext}`;

    const { error: upErr } = await db.storage
      .from("materiais")
      .upload(path, bytes, { contentType: mime, upsert: false });
    if (upErr) return jsonErr(400, "Falha no upload: " + upErr.message);

    const { data: pub } = db.storage.from("materiais").getPublicUrl(path);
    return jsonOk({ url: pub.publicUrl, path });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" || e.message === "Token inválido" ? 401 : 500, e.message);
  }
};
