import type { APIRoute } from "astro";
import { jsonOk, jsonErr, requireRepresentante } from "~/lib/auth";
import { representanteMe, representanteAtualizarPerfil } from "~/lib/manut/representantes";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    const claims = await requireRepresentante(request);
    const rep = await representanteMe(claims.sub);
    return jsonOk(rep);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

export const PATCH: APIRoute = async ({ request }) => {
  try {
    const claims = await requireRepresentante(request);
    const body = await request.json();
    const rep = await representanteAtualizarPerfil(claims.sub, {
      telefone: body.telefone,
      chavePix: body.chave_pix,
      tipoChavePix: body.tipo_chave_pix,
    });
    return jsonOk(rep);
  } catch (e: any) {
    const code = e.message === "Não autenticado" ? 401 : 400;
    return jsonErr(code, e.message);
  }
};
