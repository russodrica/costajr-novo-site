import type { APIRoute } from "astro";
import { requireCliente, jsonOk, jsonErr } from "~/lib/auth";
import { clienteMe, clienteDashboard } from "~/lib/manut/clientes";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    const claims = await requireCliente(request);
    const [cliente, dashboard] = await Promise.all([
      clienteMe(claims.sub),
      clienteDashboard(claims.sub),
    ]);
    return jsonOk({ cliente, dashboard });
  } catch (e: any) {
    return jsonErr(401, e.message);
  }
};
