import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "~/lib/auth";
import { registrarRepasse } from "~/lib/manut/representantes";

export const prerender = false;

export const POST: APIRoute = async ({ request, params }) => {
  try {
    await requireAdminCookie(request);
    const id = String(params.id);
    const body = await request.json();
    const valor = Number(body.valor);
    if (!valor || valor <= 0) return jsonErr(400, "Valor do repasse deve ser positivo");
    const r = await registrarRepasse(id, {
      valor,
      dataRepasse: body.data_repasse || body.dataRepasse,
      observacao: body.observacao,
    });
    return jsonOk(r);
  } catch (e: any) {
    const code = e.message === "Não autenticado" ? 401 : 400;
    return jsonErr(code, e.message);
  }
};
