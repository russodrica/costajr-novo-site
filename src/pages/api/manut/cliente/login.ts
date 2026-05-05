import type { APIRoute } from "astro";
import { clienteLogin } from "~/lib/manut/clientes";
import { jsonOk, jsonErr } from "~/lib/auth";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const { email, senha } = await request.json();
    return jsonOk(await clienteLogin({ email, senha }));
  } catch (e: any) {
    return jsonErr(401, e.message);
  }
};
