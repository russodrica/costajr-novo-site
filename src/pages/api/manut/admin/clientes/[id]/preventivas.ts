import type { APIRoute } from "astro";
import { requireAdmin, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";

export const prerender = false;

// POST — agendar uma preventiva avulsa OU gerar automaticamente o ciclo completo
export const POST: APIRoute = async ({ request, params }) => {
  try {
    await requireAdmin(request);
    const { id } = params;
    if (!id) return jsonErr(400, "id obrigatório");

    const body = await request.json();

    // ── Geração automática do ciclo ──────────────────────────────
    if (body.action === "gerar_automaticas") {
      const db = supabaseAdmin();

      // Busca dados do cliente
      const { data: cliente } = await db
        .from("manut_clientes")
        .select("visitas_contratadas")
        .eq("id", id)
        .single();

      const visitas = Math.max(1, Math.min(Number(body.visitas || cliente?.visitas_contratadas || 1), 60));
      const dataBase = body.data_base ? new Date(body.data_base) : new Date();

      const rows: Record<string, any>[] = [];
      let data = new Date(dataBase);
      data.setDate(data.getDate() + 10);

      for (let i = 0; i < visitas; i++) {
        rows.push({
          cliente_id: id,
          status: "agendada",
          data_agendada: data.toISOString().slice(0, 10),
        });
        data = new Date(data);
        data.setDate(data.getDate() + 30);
      }

      const { data: created, error } = await db
        .from("manut_preventivas")
        .insert(rows)
        .select("id, data_agendada, status, observacoes, manut_lojas(id, nome), manut_tecnicos(id, nome)");
      if (error) throw new Error(error.message);
      return jsonOk({ geradas: created?.length || 0, preventivas: created || [] }, 201);
    }

    // ── Agendamento avulso ───────────────────────────────────────
    const { loja_id, tecnico_id, data_agendada, observacoes } = body;
    if (!data_agendada) throw new Error("Data é obrigatória");

    const { data, error } = await supabaseAdmin()
      .from("manut_preventivas")
      .insert({
        cliente_id: id,
        loja_id: loja_id || null,
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

// PUT — editar data, técnico, status ou observações de uma preventiva
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
