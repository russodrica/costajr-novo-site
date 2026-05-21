import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "~/lib/auth";
import { atualizarMaterial, excluirMaterial } from "~/lib/manut/representantes";

export const prerender = false;

export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    await requireAdminCookie(request);
    const id = String(params.id);
    const body = await request.json();
    const m = await atualizarMaterial(id, body);
    return jsonOk(m);
  } catch (e: any) {
    const code = e.message === "Não autenticado" ? 401 : 400;
    return jsonErr(code, e.message);
  }
};

export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    await requireAdminCookie(request);
    const id = String(params.id);
    const r = await excluirMaterial(id);
    return jsonOk(r);
  } catch (e: any) {
    const code = e.message === "Não autenticado" ? 401 : 400;
    return jsonErr(code, e.message);
  }
};
