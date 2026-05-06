import type { APIRoute } from "astro";
import { requireAdmin, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";

export const prerender = false;

export const POST: APIRoute = async ({ request, params }) => {
  try {
    await requireAdmin(request);
    const { id } = params;
    if (!id) return jsonErr(400, "id obrigatório");

    const body = await request.json();
    const { loja_id, tecnico_id, data_agendada, observacoes } = body;
    if (!loja_id || !data_agendada) throw new Error("Loja e data são obrigatórios");

    const { data, error } = await supabaseAdmin()
      .from("manut_preventivas")
      .insert({
        cliente_id: id,
        loja_id,
        tecnico_id: tecnico_id || null,
        data_agendada,
        observacoes: observacoes?.trim() || null,
        status: "agendada",
      })
      .select("id, data_agendada, status, observacoes, manut_lojas(id, nome), manut_tecnicos(id, nome)")
      .single();
    if (error) throw new Error(error.message);
    return jsonOk(data, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autorizado" ? 401 : 500, e.message);
  }
};

export const PUT: APIRoute = async ({ request, params }) => {
  try {
    await requireAdmin(request);
    const { id } = params;
    const body = await request.json();
    const { prev_id, data_agendada, tecnico_id, status, observacoes } = body;
    if (!prev_id) return jsonErr(400, "prev_id obrigatório");

    const update: Record<string, any> = {};
    if (data_agendada !== undefined) update.data_agendada = data_agendada;
    if (tecnico_id !== undefined) update.tecnico_id = tecnico_id;
    if (status !== undefined) update.status = status;
    if (observacoes !== undefined) update.observacoes = observacoes;

    const { error } = await supabaseAdmin()
      .from("manut_preventivas")
      .update(update)
      .eq("id", prev_id)
      .eq("cliente_id", id);
    if (error) throw new Error(error.message);
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autorizado" ? 401 : 500, e.message);
  }
};
