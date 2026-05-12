import type { APIRoute } from "astro";
import { requireCliente, jsonOk, jsonErr } from "~/lib/auth";
import { gerarCupomRenovacao } from "~/lib/manut/clientes";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const claims = await requireCliente(request);
    const r = await gerarCupomRenovacao(claims.sub);
    return jsonOk(r);
  } catch (e: any) {
    return jsonErr(400, e.message);
  }
};
