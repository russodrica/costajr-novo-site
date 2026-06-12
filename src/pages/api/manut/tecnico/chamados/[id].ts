import type { APIRoute } from "astro";
import { requireTecnico, jsonOk, jsonErr } from "~/lib/auth";
import { atualizarStatusChamado } from "~/lib/manut/chamados";

export const prerender = false;

export const PUT: APIRoute = async ({ request, params }) => {
  try {
    const claims = await requireTecnico(request);
    const { status, observacao, motivoPendencia, fotosEvidencia, fotosAntes, fotosDepois, geo } = await request.json();
    return jsonOk(await atualizarStatusChamado({
      chamadoId: params.id!,
      tecnicoId: claims.sub,
      status,
      observacao,
      motivoPendencia,
      fotosEvidencia,
      fotosAntes,
      fotosDepois,
      geo,
      exigirFotos: true, // transição vinda do técnico: foto ANTES/DEPOIS obrigatória
    }));
  } catch (e: any) {
    return jsonErr(400, e.message);
  }
};
