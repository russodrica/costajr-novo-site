import type { APIRoute } from "astro";
import { requireTecnico, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";
import { listarLojaIdsDoTecnico } from "~/lib/manut/tecnicos";

export const prerender = false;

// POST /api/manut/tecnico/preventivas/[id]/foto
// Body: multipart/form-data com:
//   - file: arquivo (image/jpeg|png|webp, max 10MB)
//   - kind: "inicial" | "hidraulica" | "civil" | "eletrica" | "assinatura"
// Retorna: { url, kind }
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

    const form = await request.formData();
    const file = form.get("file") as File | null;
    const kind = String(form.get("kind") || "");
    if (!file) return jsonErr(400, "Arquivo ausente");
    if (!["inicial", "hidraulica", "civil", "eletrica", "assinatura"].includes(kind)) {
      return jsonErr(400, "kind inválido");
    }

    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
    const ts = Date.now();
    const path = `${id}/${kind}/${ts}.${ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());

    const { error: upErr } = await db.storage
      .from("preventivas")
      .upload(path, bytes, {
        contentType: file.type || "image/jpeg",
        upsert: false,
      });
    if (upErr) return jsonErr(400, "Falha no upload: " + upErr.message);

    const { data: pub } = db.storage.from("preventivas").getPublicUrl(path);
    return jsonOk({ url: pub.publicUrl, kind, path });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" || e.message === "Token inválido" ? 401 : 500, e.message);
  }
};
