import type { APIRoute } from "astro";
import { requireAdmin, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";

export const prerender = false;

export const PUT: APIRoute = async ({ request, params }) => {
  try {
    await requireAdmin(request);
    const { id } = params;
    if (!id) return jsonErr(400, "id obrigatório");

    const body = await request.json();
    const { status, resposta_admin } = body;
    const update: Record<string, any> = {};
    if (status) update.status = status;
    if (resposta_admin !== undefined) update.resposta_admin = resposta_admin;

    if (Object.keys(update).length === 0) return jsonErr(400, "Nenhum campo para atualizar");
    const { error } = await supabaseAdmin().from("manut_suporte").update(update).eq("id", id);
    if (error) throw new Error(error.message);
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autorizado" ? 401 : 500, e.message);
  }
};
