import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../lib/auth";
import { bloqueioSeSemLeitura } from "../../../../lib/permissoes";
import { vobiFinanceiro, vobiConfigurado } from "../../../../lib/vobi";

export const prerender = false;

// GET /api/admin/vobi/financeiro?ano=YYYY → indicadores financeiros AO VIVO da Vobi.
export const GET: APIRoute = async ({ request, url }) => {
  try {
    const admin = await requireAdminCookie(request);
    const ro = await bloqueioSeSemLeitura(admin, "vobi-financeiro");
    if (ro) return ro;
    if (!vobiConfigurado()) return jsonErr(503, "Credenciais da Vobi não configuradas. Cole VOBI_UUID e VOBI_SECRET nas variáveis de ambiente da Vercel e reimplante.");
    const ano = Number(url.searchParams.get("ano")) || new Date().getFullYear();
    const data = await vobiFinanceiro(ano);
    return jsonOk(data);
  } catch (e: any) {
    if (e.vobiConfig) return jsonErr(503, e.message);
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message || "Falha ao consultar a Vobi.");
  }
};
