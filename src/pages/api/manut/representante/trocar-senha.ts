import type { APIRoute } from "astro";
import { jsonOk, jsonErr, requireRepresentante } from "~/lib/auth";
import { representanteTrocarSenha } from "~/lib/manut/representantes";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const claims = await requireRepresentante(request);
    const body = await request.json();
    const out = await representanteTrocarSenha(claims.sub, body.senhaAtual, body.novaSenha);
    return jsonOk(out);
  } catch (e: any) {
    const code = e.message === "Não autenticado" ? 401 : 400;
    return jsonErr(code, e.message);
  }
};
