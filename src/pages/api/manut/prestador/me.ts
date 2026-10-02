import type { APIRoute } from "astro";
import { requirePrestador, jsonOk, jsonErr } from "~/lib/auth";
import { prestadorMe } from "~/lib/manut/prestadores";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    const claims = await requirePrestador(request);
    return jsonOk({ prestador: await prestadorMe(claims.sub) });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" || e.message === "Token inválido" ? 401 : 500, e.message);
  }
};
