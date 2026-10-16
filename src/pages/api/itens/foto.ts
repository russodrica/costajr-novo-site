import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/supabase";
import { ITENS_BUCKET, lerItens, validarLink } from "../../../lib/itensDeposito";

export const prerender = false;

// GET ?t=<token>&n=<nº do item> → a foto, SÓ se o link ainda vale. A foto não tem
// endereço próprio: passa por aqui, então expirar/revogar o link corta o acesso.
export const GET: APIRoute = async ({ url }) => {
  const db = supabaseAdmin();
  const ok = await validarLink(db, String(url.searchParams.get("t") || ""));
  if (!ok) return new Response("Link expirado", { status: 403 });
  const n = Number(url.searchParams.get("n"));
  const item = (await lerItens(db)).find((i) => i.n === n && i.status === "disponivel");
  if (!item?.foto) return new Response("Sem foto", { status: 404 });
  const { data } = await db.storage.from(ITENS_BUCKET).download(item.foto);
  if (!data) return new Response("Sem foto", { status: 404 });
  return new Response(await data.arrayBuffer(), {
    headers: { "content-type": "image/jpeg", "cache-control": "private, no-store", "x-robots-tag": "noindex" },
  });
};
