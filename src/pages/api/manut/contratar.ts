import type { APIRoute } from "astro";
import { contratarSubmit } from "~/lib/manut/clientes";
import { jsonOk, jsonErr } from "~/lib/auth";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const r = await contratarSubmit(body);
    return jsonOk(r);
  } catch (e: any) {
    return jsonErr(400, e.message);
  }
};

export const OPTIONS: APIRoute = () =>
  new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST,OPTIONS",
      "access-control-allow-headers": "content-type"
    }
  });
