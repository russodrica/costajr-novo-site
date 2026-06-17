import type { APIRoute } from "astro";
import { tecnicoLogin } from "~/lib/manut/tecnicos";
import { jsonOk, jsonErr } from "~/lib/auth";
import { clientIp, rateLimit } from "~/lib/ratelimit";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    if (!(await rateLimit(`login:${clientIp(request)}`, 12, 600))) return jsonErr(429, "Muitas tentativas. Aguarde alguns minutos e tente novamente.");
    const { email, senha } = await request.json();
    return jsonOk(await tecnicoLogin({ email, senha }));
  } catch (e: any) {
    return jsonErr(401, e.message);
  }
};
