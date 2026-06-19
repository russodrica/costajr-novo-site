import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";
import { bloqueioSeSoLeitura } from "~/lib/permissoes";

export const prerender = false;

// POST { path } → remove o arquivo da pasta inbox/ do bucket `rh` (descarta sem anexar).
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const _ro = await bloqueioSeSoLeitura(admin, "caixa-entrada"); if (_ro) return _ro;
    const { path } = await request.json().catch(() => ({}));
    const p = String(path || "").trim();
    if (!p || !p.startsWith("inbox/")) return jsonErr(400, "Caminho inválido.");
    const db = supabaseAdmin();
    await db.storage.from("rh").remove([p]).catch(() => {});
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
