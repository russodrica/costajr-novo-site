import type { APIRoute } from "astro";
import { jsonOk, jsonErr } from "~/lib/auth";
import { representanteLogin } from "~/lib/manut/representantes";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const out = await representanteLogin({ email: body.email, senha: body.senha });
    return jsonOk(out);
  } catch (e: any) {
    return jsonErr(401, e.message || "Erro ao fazer login");
  }
};
