import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "~/lib/auth";
import { buscarRepresentanteDetalhado, atualizarRepresentante } from "~/lib/manut/representantes";

export const prerender = false;

export const GET: APIRoute = async ({ request, params }) => {
  try {
    await requireAdminCookie(request);
    const id = String(params.id);
    const result = await buscarRepresentanteDetalhado(id);
    if (!result) return jsonErr(404, "Representante não encontrado");
    return jsonOk(result);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    await requireAdminCookie(request);
    const id = String(params.id);
    const body = await request.json();
    const rep = await atualizarRepresentante(id, {
      nome: body.nome,
      email: body.email,
      telefone: body.telefone,
      ativo: body.ativo,
    });
    return jsonOk(rep);
  } catch (e: any) {
    const code = e.message === "Não autenticado" ? 401 : 400;
    return jsonErr(code, e.message);
  }
};
