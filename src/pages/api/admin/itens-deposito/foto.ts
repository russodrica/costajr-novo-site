import type { APIRoute } from "astro";
import { requireAdminCookie, temPerfil } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";
import { ITENS_BUCKET, lerItens } from "../../../../lib/itensDeposito";

export const prerender = false;

// Miniatura para a tela do administrador (cookie de admin).
export const GET: APIRoute = async ({ request, url }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, ["admin"])) return new Response("Sem permissão", { status: 403 });
    const db = supabaseAdmin();
    const n = Number(url.searchParams.get("n"));
    const item = (await lerItens(db)).find((i) => i.n === n);
    if (!item?.foto) return new Response("Sem foto", { status: 404 });
    const { data } = await db.storage.from(ITENS_BUCKET).download(item.foto);
    if (!data) return new Response("Sem foto", { status: 404 });
    return new Response(await data.arrayBuffer(), { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=300" } });
  } catch {
    return new Response("Não autenticado", { status: 401 });
  }
};
