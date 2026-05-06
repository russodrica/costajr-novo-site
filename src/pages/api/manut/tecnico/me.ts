import type { APIRoute } from "astro";
import { requireTecnico, jsonOk, jsonErr } from "~/lib/auth";
import { tecnicoMe } from "~/lib/manut/tecnicos";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    const claims = await requireTecnico(request);
    const tecnico = await tecnicoMe(claims.sub);
    return jsonOk({ tecnico });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" || e.message === "Token inválido" ? 401 : 500, e.message);
  }
};
