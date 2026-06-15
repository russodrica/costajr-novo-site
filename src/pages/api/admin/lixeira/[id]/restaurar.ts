import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { restaurarDaLixeira } from "../../../../../lib/auditoria";

export const prerender = false;

// POST /api/admin/lixeira/[id]/restaurar — recupera o registro de volta à tabela.
export const POST: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!["admin"].includes(admin.role)) return jsonErr(403, "Sem permissão.");
    const db = supabaseAdmin();
    const r = await restaurarDaLixeira(db, { req: request, admin }, params.id!);
    if (!r.ok) return jsonErr(400, r.error || "Falha ao restaurar");
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
