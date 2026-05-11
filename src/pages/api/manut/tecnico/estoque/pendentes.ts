import type { APIRoute } from "astro";
import { requireTecnico, jsonOk, jsonErr } from "~/lib/auth";
import { listarLojaIdsDoTecnico } from "~/lib/manut/tecnicos";
import { listarReposicoesPendentes } from "~/lib/manut/estoque";

export const prerender = false;

// GET — reposições pendentes (pago ou aguardando_visita) das lojas do técnico
export const GET: APIRoute = async ({ request }) => {
  try {
    const claims = await requireTecnico(request);
    const lojaIds = await listarLojaIdsDoTecnico(claims.sub);
    const pendentes = await listarReposicoesPendentes(lojaIds);
    return jsonOk(pendentes);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" || e.message === "Token inválido" ? 401 : 500, e.message);
  }
};
