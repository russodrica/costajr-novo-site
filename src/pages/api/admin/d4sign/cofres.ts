import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../lib/auth";
import { d4signConfigurado, listarCofres } from "../../../../lib/d4sign";

export const prerender = false;

// GET /api/admin/d4sign/cofres — lista os cofres da conta D4Sign (para escolher
// onde guardar o documento antes de enviar para assinatura).
export const GET: APIRoute = async ({ request }) => {
  try {
    await requireAdminCookie(request);
    if (!d4signConfigurado()) return jsonErr(400, "D4Sign não configurada (defina D4SIGN_TOKEN no ambiente de produção).");
    const cofres = await listarCofres();
    return jsonOk(cofres.map((c) => ({ uuid: c.uuid_safe, nome: c["name-safe"] })));
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
