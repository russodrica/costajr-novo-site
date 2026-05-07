import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";

export const prerender = false;

export const POST: APIRoute = async ({ request, params }) => {
  try {
    await requireAdminCookie(request);
    const clienteId = params.id!;
    const db = supabaseAdmin();

    // Busca cliente
    const { data: cliente } = await db
      .from("manut_clientes")
      .select("data_contratacao, visitas_contratadas, plano_selecionado, created_at")
      .eq("id", clienteId)
      .single();
    if (!cliente) return jsonErr(404, "Cliente não encontrado");

    // Busca lojas do cliente
    const { data: lojas } = await db
      .from("manut_lojas")
      .select("id")
      .eq("cliente_id", clienteId)
      .neq("status", "cancelada");
    if (!lojas?.length) return jsonErr(400, "Cadastre ao menos uma loja antes de gerar preventivas");

    // Deriva total de visitas a partir do plano (nome contém trimestral/semestral/anual)
    const plano = (cliente.plano_selecionado || "").toLowerCase();
    let totalVisitas: number;
    if (plano.includes("trimestral")) totalVisitas = 3;
    else if (plano.includes("semestral")) totalVisitas = 6;
    else if (plano.includes("anual")) totalVisitas = 12;
    else totalVisitas = cliente.visitas_contratadas || 12;
    const base = new Date(cliente.data_contratacao || cliente.created_at);

    // Remove preventivas agendadas existentes (não altera concluídas/canceladas)
    await db
      .from("manut_preventivas")
      .delete()
      .eq("cliente_id", clienteId)
      .eq("status", "agendada");

    // Gera preventivas para cada loja
    const inserts: object[] = [];
    for (const loja of lojas) {
      for (let i = 0; i < totalVisitas; i++) {
        // 1ª visita = base + 10 dias; seguintes = +30 dias cada
        const diasOffset = i === 0 ? 10 : 10 + i * 30;
        const dataAgendada = new Date(base);
        dataAgendada.setDate(dataAgendada.getDate() + diasOffset);

        inserts.push({
          cliente_id: clienteId,
          loja_id: loja.id,
          data_agendada: dataAgendada.toISOString(),
          status: "agendada",
          numero_visita: i + 1,
        });
      }
    }

    const { data, error } = await db.from("manut_preventivas").insert(inserts).select();
    if (error) return jsonErr(400, error.message);

    return jsonOk({ criadas: data?.length ?? 0 });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
