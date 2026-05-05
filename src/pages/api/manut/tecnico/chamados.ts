import type { APIRoute } from "astro";
import { requireTecnico, jsonOk, jsonErr } from "~/lib/auth";
import { listarChamadosTecnico } from "~/lib/manut/chamados";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    const claims = await requireTecnico(request);
    return jsonOk(await listarChamadosTecnico(claims.sub));
  } catch (e: any) {
    return jsonErr(401, e.message);
  }
};
