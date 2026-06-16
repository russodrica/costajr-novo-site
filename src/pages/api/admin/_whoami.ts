import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../lib/auth";
import { perfisFrescos, carregarOverridesUsuario, nivelModuloUsuario } from "../../../lib/permissoes";

export const prerender = false;

// DEBUG temporário: mostra o que o servidor enxerga da sessão atual.
export const GET: APIRoute = async ({ request }) => {
  try {
    const c = await requireAdminCookie(request);
    const perfis = await perfisFrescos(c);
    const overrides = await carregarOverridesUsuario(c.sub);
    const nivelRhAnalytics = await nivelModuloUsuario(c, "rh-analytics");
    return jsonOk({
      sub: c.sub,
      tipo: c.tipo,
      tokenRole: c.role,
      tokenRoles: (c as any).roles ?? null,
      perfisFrescos: perfis,
      overrideRhAnalytics: overrides["rh-analytics"] ?? "(nenhum override)",
      qtdOverrides: Object.keys(overrides).length,
      nivelEfetivoRhAnalytics: nivelRhAnalytics,
    });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
