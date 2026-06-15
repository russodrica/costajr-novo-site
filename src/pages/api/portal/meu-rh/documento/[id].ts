import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { requireAdmin, jsonOk, jsonErr } from "~/lib/auth";

export const prerender = false;

// GET /api/portal/meu-rh/documento/[id] — URL assinada (10min) do PRÓPRIO documento.
// Só libera se o documento for do colaborador logado (bucket privado 'rh').
export const GET: APIRoute = async ({ request, params }) => {
  try {
    const claims = await requireAdmin(request);
    const sb = supabaseAdmin();
    const { data: colab } = await sb.from("rh_colaboradores").select("id").eq("profile_id", claims.sub).maybeSingle();
    if (!colab) return jsonErr(403, "Sem vínculo de RH.");
    const { data: doc } = await sb.from("rh_documentos").select("id, colaborador_id, storage_path, url").eq("id", params.id!).maybeSingle();
    if (!doc || doc.colaborador_id !== colab.id) return jsonErr(404, "Documento não encontrado.");
    if (doc.storage_path) {
      const { data: signed } = await sb.storage.from("rh").createSignedUrl(doc.storage_path, 600);
      if (signed?.signedUrl) return jsonOk({ url: signed.signedUrl });
    }
    if (doc.url) return jsonOk({ url: doc.url });
    return jsonErr(404, "Arquivo indisponível.");
  } catch {
    return jsonErr(401, "Não autenticado.");
  }
};
