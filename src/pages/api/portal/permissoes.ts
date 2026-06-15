import type { APIRoute } from "astro";
import { requireAdmin, jsonOk, jsonErr } from "~/lib/auth";
import { permissoesDoUsuario } from "~/lib/permissoes";

export const prerender = false;

// GET /api/portal/permissoes — áreas liberadas para o usuário logado (para o menu)
export const GET: APIRoute = async ({ request }) => {
  try {
    const claims = await requireAdmin(request);
    const { areas, categoriasKb, perfis } = await permissoesDoUsuario(claims);
    return jsonOk({ areas, categorias_kb: categoriasKb, perfis, role: perfis[0] || claims.role });
  } catch {
    return jsonErr(401, "Não autenticado.");
  }
};
