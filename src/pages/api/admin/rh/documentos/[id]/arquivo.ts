import type { APIRoute } from "astro";
import { requireAdminCookie, jsonErr } from "../../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../../lib/supabase";

export const prerender = false;

// GET /api/admin/rh/documentos/[id]/arquivo
// Documentos de RH ficam em bucket PRIVADO (LGPD). Este endpoint valida o
// admin autenticado e redireciona para uma URL assinada de curta duração.
export const GET: APIRoute = async ({ request, params }) => {
  try {
    await requireAdminCookie(request);
    const db = supabaseAdmin();
    const { data: doc } = await db.from("rh_documentos").select("id, url, storage_path").eq("id", params.id!).maybeSingle();
    if (!doc) return jsonErr(404, "Documento não encontrado");

    // documento com URL externa (link manual) — redireciona direto
    if (!doc.storage_path) {
      if (doc.url) return new Response(null, { status: 302, headers: { location: doc.url } });
      return jsonErr(404, "Documento sem arquivo");
    }

    const { data: assinada, error } = await db.storage.from("rh").createSignedUrl(doc.storage_path, 600); // 10 min
    if (error || !assinada?.signedUrl) return jsonErr(500, error?.message || "Falha ao assinar URL");
    return new Response(null, { status: 302, headers: { location: assinada.signedUrl, "cache-control": "no-store" } });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
