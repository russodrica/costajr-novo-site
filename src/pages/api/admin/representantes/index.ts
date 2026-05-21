import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "~/lib/auth";
import { listarRepresentantes, criarRepresentante } from "~/lib/manut/representantes";

export const prerender = false;

export const GET: APIRoute = async ({ request, url }) => {
  try {
    await requireAdminCookie(request);
    const somenteAtivos = url.searchParams.get("ativos") === "1";
    const reps = await listarRepresentantes({ somenteAtivos });
    return jsonOk(reps);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    await requireAdminCookie(request);
    const body = await request.json();
    const rep = await criarRepresentante({
      nome: body.nome,
      email: body.email,
      telefone: body.telefone,
      chavePix: body.chave_pix,
      tipoChavePix: body.tipo_chave_pix,
    });
    return jsonOk(rep, 201);
  } catch (e: any) {
    const code = e.message === "Não autenticado" ? 401 : 400;
    return jsonErr(code, e.message);
  }
};
