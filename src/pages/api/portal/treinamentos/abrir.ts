import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { requireAdmin } from "~/lib/auth";
import { assinarTreinoToken, nomeDoUsuario } from "~/lib/treinoStorage";

export const prerender = false;

// GET /api/portal/treinamentos/abrir?tipo=video|pdf&id=<id>
// Exige login. Gera um token com o NOME do usuário logado e redireciona para o
// player com marca d'água (/treino/[token]) — o vídeo abre estampado com o nome
// de quem está assistindo. O link da base de conhecimento aponta pra cá.
export const GET: APIRoute = async ({ request, url }) => {
  try {
    const claims = await requireAdmin(request);
    const tipo = url.searchParams.get("tipo") === "pdf" ? "pdf" : "video";
    const id = url.searchParams.get("id") || "";
    if (!id) return new Response("Parâmetros inválidos.", { status: 400 });

    const sb = supabaseAdmin();
    const nome = await nomeDoUsuario(sb, (claims as any).sub, (claims as any).email);
    const token = await assinarTreinoToken({ vtipo: tipo, id, nome });

    return new Response(null, { status: 302, headers: { location: `/treino/${token}`, "cache-control": "no-store" } });
  } catch {
    return new Response("Faça login na plataforma para abrir o treinamento.", { status: 401 });
  }
};
