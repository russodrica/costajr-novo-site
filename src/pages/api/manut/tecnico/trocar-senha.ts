import type { APIRoute } from "astro";
import { requireTecnico, jsonOk, jsonErr } from "~/lib/auth";
import { tecnicoTrocarSenha } from "~/lib/manut/tecnicos";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const claims = await requireTecnico(request);
    const { senhaAtual, novaSenha } = await request.json();
    if (!senhaAtual || !novaSenha) throw new Error("Dados obrigatórios");
    const result = await tecnicoTrocarSenha(claims.sub, senhaAtual, novaSenha);
    return jsonOk(result);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" || e.message === "Token inválido" ? 401 : 400, e.message);
  }
};
