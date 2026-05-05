import type { APIRoute } from "astro";
import { requireAdmin, jsonOk, jsonErr } from "~/lib/auth";
import { adminAtribuirChamado } from "~/lib/manut/chamados";

export const prerender = false;

export const PUT: APIRoute = async ({ request, params }) => {
  try {
    await requireAdmin(request);
    const { tecnicoId } = await request.json();
    if (!tecnicoId) return jsonErr(400, "tecnicoId obrigatório");
    return jsonOk(await adminAtribuirChamado(params.id!, tecnicoId));
  } catch (e: any) {
    return jsonErr(400, e.message);
  }
};
