import type { APIRoute } from "astro";
import { jsonOk, jsonErr } from "~/lib/auth";
import { representanteLogin } from "~/lib/manut/representantes";
import { clientIp, rateLimit } from "~/lib/ratelimit";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    if (!(await rateLimit(`login:${clientIp(request)}`, 12, 600))) return jsonErr(429, "Muitas tentativas. Aguarde alguns minutos e tente novamente.");
    const body = await request.json();
    const out = await representanteLogin({ email: body.email, senha: body.senha });
    return jsonOk(out);
  } catch (e: any) {
    return jsonErr(401, e.message || "Erro ao fazer login");
  }
};
