import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { requireAdmin } from "~/lib/auth";
import { urlAssinadaTreino } from "~/lib/treinoStorage";

export const prerender = false;

// GET /api/portal/treinamentos/abrir?tipo=video|pdf&id=<id>
// Exige login (cookie admin_token OU x-portal-auth). Gera uma URL ASSINADA nova
// e redireciona — o link da base de conhecimento aponta pra cá, então o vídeo só
// abre para quem está logado na empresa. Link externo (YouTube) redireciona direto.
export const GET: APIRoute = async ({ request, url }) => {
  try {
    await requireAdmin(request);
    const tipo = url.searchParams.get("tipo") || "video";
    const id = url.searchParams.get("id") || "";
    if (!id || !["video", "pdf"].includes(tipo)) return new Response("Parâmetros inválidos.", { status: 400 });

    const sb = supabaseAdmin();
    const tabela = tipo === "pdf" ? "portal_treinamentos_pdfs" : "portal_treinamentos_videos";
    const { data: item } = await sb.from(tabela).select("*").eq("id", id).maybeSingle();
    if (!item) return new Response("Treinamento não encontrado.", { status: 404 });

    const original = tipo === "pdf" ? item.url : item.url_video;
    const assinada = await urlAssinadaTreino(sb, original);
    if (!assinada) return new Response("Arquivo indisponível.", { status: 404 });

    return new Response(null, { status: 302, headers: { location: assinada, "cache-control": "no-store" } });
  } catch {
    return new Response("Faça login na plataforma para abrir o treinamento.", { status: 401 });
  }
};
