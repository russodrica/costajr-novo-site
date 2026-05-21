import type { APIRoute } from "astro";
import { jsonOk, jsonErr, requireRepresentante } from "~/lib/auth";
import { representanteDashboard, listarMateriaisRepresentante } from "~/lib/manut/representantes";
import { listarRegrasIndicacao } from "~/lib/manut/indicacao-regras";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    const claims = await requireRepresentante(request);
    const [dashboard, materiais] = await Promise.all([
      representanteDashboard(claims.sub),
      listarMateriaisRepresentante(),
    ]);
    return jsonOk({
      ...dashboard,
      materiais,
      regrasIndicacao: listarRegrasIndicacao(),
    });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
