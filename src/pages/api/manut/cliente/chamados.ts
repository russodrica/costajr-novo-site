import type { APIRoute } from "astro";
import { requireCliente, jsonOk, jsonErr } from "~/lib/auth";
import { listarChamadosCliente, criarChamadoCliente } from "~/lib/manut/chamados";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    const claims = await requireCliente(request);
    return jsonOk(await listarChamadosCliente(claims.sub));
  } catch (e: any) {
    return jsonErr(401, e.message);
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const claims = await requireCliente(request);
    const { lojaId, tipo, localLoja, descricao } = await request.json();
    if (!lojaId || !tipo || !descricao) return jsonErr(400, "lojaId, tipo e descricao são obrigatórios");
    return jsonOk(await criarChamadoCliente({ clienteId: claims.sub, lojaId, tipo, localLoja, descricao }));
  } catch (e: any) {
    return jsonErr(400, e.message);
  }
};
