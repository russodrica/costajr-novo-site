import type { APIRoute } from "astro";
import { requireCliente, jsonOk, jsonErr } from "~/lib/auth";
import { clienteTrocarSenha } from "~/lib/manut/clientes";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const claims = await requireCliente(request);
    const { senhaAtual, novaSenha } = await request.json();
    return jsonOk(await clienteTrocarSenha(claims.sub, senhaAtual, novaSenha));
  } catch (e: any) {
    return jsonErr(400, e.message);
  }
};
