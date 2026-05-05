import type { APIRoute } from "astro";
import { requireTecnico, jsonOk, jsonErr } from "~/lib/auth";
import { atualizarStatusChamado } from "~/lib/manut/chamados";

export const prerender = false;

export const PUT: APIRoute = async ({ request, params }) => {
  try {
    const claims = await requireTecnico(request);
    const { status, observacao } = await request.json();
    return jsonOk(await atualizarStatusChamado({ chamadoId: params.id!, tecnicoId: claims.sub, status, observacao }));
  } catch (e: any) {
    return jsonErr(400, e.message);
  }
};
