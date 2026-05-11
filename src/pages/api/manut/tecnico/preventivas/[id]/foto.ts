import type { APIRoute } from "astro";
import { requireTecnico, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";
import { listarLojaIdsDoTecnico } from "~/lib/manut/tecnicos";

export const prerender = false;

// POST /api/manut/tecnico/preventivas/[id]/foto
// Body JSON (Astro 5 bloqueia multipart como CSRF):
//   { kind: "inicial"|"hidraulica"|"civil"|"eletrica"|"assinatura",
//     mime: "image/jpeg"|"image/png"|"image/webp",
//     data_base64: "iVBORw0..." (sem prefixo data:)  }
// Retorna: { url, kind, path }
export const POST: APIRoute = async ({ request, params }) => {
  try {
    const claims = await requireTecnico(request);
    const id = params.id!;
    const db = supabaseAdmin();

    // Autorização
    const { data: prev, error: getErr } = await db
      .from("manut_preventivas")
      .select("id,loja_id,tecnico_atribuido_id")
      .eq("id", id)
      .single();
    if (getErr || !prev) return jsonErr(404, "Preventiva não encontrada");
    const lojas = await listarLojaIdsDoTecnico(claims.sub);
    if (prev.tecnico_atribuido_id !== claims.sub && !lojas.includes(prev.loja_id)) {
      return jsonErr(403, "Sem permissão");
    }

    const body = await request.json();
    const { kind, mime, data_base64 } = body;
    if (!["inicial", "hidraulica", "civil", "eletrica", "assinatura"].includes(kind)) {
      return jsonErr(400, "kind inválido");
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) {
      return jsonErr(400, "mime não suportado");
    }
    if (!data_base64 || typeof data_base64 !== "string") {
      return jsonErr(400, "data_base64 ausente");
    }
    // Limite: 10MB base64 ≈ 13.4MB texto. Usamos 14MB de margem.
    if (data_base64.length > 14 * 1024 * 1024) return jsonErr(413, "Arquivo grande demais (máx 10MB)");

    // Decodifica base64
    const bin = atob(data_base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

    const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
    const ts = Date.now();
    const path = `${id}/${kind}/${ts}.${ext}`;

    const { error: upErr } = await db.storage
      .from("preventivas")
      .upload(path, bytes, { contentType: mime, upsert: false });
    if (upErr) return jsonErr(400, "Falha no upload: " + upErr.message);

    const { data: pub } = db.storage.from("preventivas").getPublicUrl(path);
    return jsonOk({ url: pub.publicUrl, kind, path });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" || e.message === "Token inválido" ? 401 : 500, e.message);
  }
};
