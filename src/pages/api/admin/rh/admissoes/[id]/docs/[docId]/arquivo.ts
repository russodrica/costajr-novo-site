import type { APIRoute } from "astro";
import { requireAdminCookie, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";

export const prerender = false;

// GET /api/admin/rh/admissoes/[id]/docs/[docId]/arquivo
// Docs de admissão ficam no bucket PRIVADO "rh" (LGPD). Este endpoint valida o
// admin autenticado e redireciona para uma URL assinada de curta duração.
export const GET: APIRoute = async ({ request, params }) => {
  try {
    await requireAdminCookie(request);
    const db = supabaseAdmin();
    const { data: doc } = await db
      .from("rh_admissoes_docs")
      .select("id, admissao_id, storage_path")
      .eq("id", params.docId!)
      .eq("admissao_id", params.id!)
      .maybeSingle();
    if (!doc || !doc.storage_path) return jsonErr(404, "Documento não encontrado");

    const { data: assinada, error } = await db.storage.from("rh").createSignedUrl(doc.storage_path, 600); // 10 min
    if (error || !assinada?.signedUrl) return jsonErr(500, error?.message || "Falha ao assinar URL");
    return new Response(null, { status: 302, headers: { location: assinada.signedUrl, "cache-control": "no-store" } });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
