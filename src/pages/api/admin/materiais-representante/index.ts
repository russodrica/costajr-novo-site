import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "~/lib/auth";
import { listarTodosMateriais, criarMaterial } from "~/lib/manut/representantes";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    await requireAdminCookie(request);
    const materiais = await listarTodosMateriais();
    return jsonOk(materiais);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    await requireAdminCookie(request);
    const body = await request.json();
    const m = await criarMaterial(body);
    return jsonOk(m, 201);
  } catch (e: any) {
    const code = e.message === "Não autenticado" ? 401 : 400;
    return jsonErr(code, e.message);
  }
};
