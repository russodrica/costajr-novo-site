import type { APIRoute } from "astro";
import { tecnicoLogin } from "~/lib/manut/tecnicos";
import { jsonOk, jsonErr } from "~/lib/auth";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const { email, senha } = await request.json();
    return jsonOk(await tecnicoLogin({ email, senha }));
  } catch (e: any) {
    return jsonErr(401, e.message);
  }
};
