import type { APIRoute } from "astro";
import { signToken, hashSenha, jsonOk, jsonErr } from "~/lib/auth";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const { email, senha } = await request.json();
    const adminEmail = import.meta.env.ADMIN_EMAIL;
    const adminHash = import.meta.env.ADMIN_PASSWORD_HASH;
    if (!adminEmail || !adminHash) throw new Error("Admin não configurado no servidor");
    if (email.toLowerCase() !== adminEmail.toLowerCase()) throw new Error("Credenciais inválidas");
    if ((await hashSenha(senha)) !== adminHash) throw new Error("Credenciais inválidas");
    const token = await signToken({ sub: "admin", tipo: "admin", email: adminEmail, role: "admin" });
    return jsonOk({ token });
  } catch (e: any) {
    return jsonErr(401, e.message);
  }
};
