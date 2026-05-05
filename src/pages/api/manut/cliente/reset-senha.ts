import type { APIRoute } from "astro";
import { jsonOk, jsonErr } from "~/lib/auth";
import { clienteResetSenha } from "~/lib/manut/clientes";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const { email } = await request.json();
    if (!email) return jsonErr(400, "email obrigatório");
    return jsonOk(await clienteResetSenha(email));
  } catch (e: any) {
    return jsonErr(400, e.message);
  }
};
