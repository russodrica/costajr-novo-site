import type { APIRoute } from "astro";
import { jsonOk, jsonErr } from "~/lib/auth";
import { representanteResetSenha } from "~/lib/manut/representantes";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    if (!body?.email) return jsonErr(400, "Email obrigatório");
    const out = await representanteResetSenha(body.email);
    return jsonOk(out);
  } catch (e: any) {
    return jsonErr(500, e.message);
  }
};
