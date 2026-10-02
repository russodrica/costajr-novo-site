import type { APIRoute } from "astro";
import { prestadorResetSenha } from "~/lib/manut/prestadores";
import { jsonOk, jsonErr } from "~/lib/auth";
import { clientIp, rateLimit } from "~/lib/ratelimit";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    if (!(await rateLimit(`reset:${clientIp(request)}`, 6, 600))) return jsonErr(429, "Muitas tentativas. Aguarde alguns minutos.");
    const { email } = await request.json();
    await prestadorResetSenha(String(email || ""));
    // resposta genérica (não revela se o e-mail existe)
    return jsonOk({ ok: true, msg: "Se o e-mail estiver cadastrado, enviamos uma senha temporária." });
  } catch (e: any) {
    return jsonErr(400, e.message);
  }
};
