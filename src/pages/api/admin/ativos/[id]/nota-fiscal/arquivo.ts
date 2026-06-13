import type { APIRoute } from "astro";
import { requireAdminCookie, jsonErr } from "../../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../../lib/supabase";

export const prerender = false;

// GET /api/admin/ativos/[id]/nota-fiscal/arquivo
// A NF fica em bucket PRIVADO. Valida o admin e redireciona para uma URL
// assinada de curta duração (10 min). Sem cache.
export const GET: APIRoute = async ({ request, params }) => {
  try {
    await requireAdminCookie(request);
    const db = supabaseAdmin();
    const { data: ativo } = await db.from("ativos").select("id, nota_fiscal_path, nota_fiscal_url").eq("id", params.id!).maybeSingle();
    if (!ativo) return jsonErr(404, "Ativo não encontrado");

    if (!ativo.nota_fiscal_path) {
      // sem arquivo no cofre — cai no link externo, se houver
      if (ativo.nota_fiscal_url) return new Response(null, { status: 302, headers: { location: ativo.nota_fiscal_url } });
      return jsonErr(404, "Nota fiscal sem arquivo");
    }

    const { data: assinada, error } = await db.storage.from("ativos-docs").createSignedUrl(ativo.nota_fiscal_path, 600);
    if (error || !assinada?.signedUrl) return jsonErr(500, error?.message || "Falha ao assinar URL");
    return new Response(null, { status: 302, headers: { location: assinada.signedUrl, "cache-control": "no-store" } });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
