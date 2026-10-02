import type { APIRoute } from "astro";
import { prestadorCadastrar } from "~/lib/manut/prestadores";
import { jsonOk, jsonErr } from "~/lib/auth";
import { clientIp, rateLimit } from "~/lib/ratelimit";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    if (!(await rateLimit(`prestcad:${clientIp(request)}`, 8, 600))) return jsonErr(429, "Muitas tentativas. Aguarde alguns minutos.");
    const body = await request.json();
    return jsonOk(await prestadorCadastrar(body), 201);
  } catch (e: any) {
    return jsonErr(400, e.message);
  }
};
