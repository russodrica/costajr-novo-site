import type { APIRoute } from "astro";
import { requireAdmin, jsonOk, jsonErr } from "~/lib/auth";
import { adminListarChamados } from "~/lib/manut/chamados";

export const prerender = false;

export const GET: APIRoute = async ({ request, url }) => {
  try {
    await requireAdmin(request);
    const status = url.searchParams.get("status") || undefined;
    return jsonOk(await adminListarChamados(status));
  } catch (e: any) {
    return jsonErr(401, e.message);
  }
};
