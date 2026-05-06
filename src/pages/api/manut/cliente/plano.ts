import type { APIRoute } from "astro";
import { requireCliente, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    const claims = await requireCliente(request);
    const db = supabaseAdmin();

    const [clienteRes, pagamentosRes, visitasRes] = await Promise.all([
      db.from("manut_clientes")
        .select("id,nome,email,plano_selecionado,valor_mensal_contratado,visitas_contratadas,status,data_contratacao")
        .eq("id", claims.sub)
        .single(),
      db.from("manut_pagamentos")
        .select("id,valor,referencia,status,data_vencimento,data_pagamento,mercado_pago_id")
        .eq("cliente_id", claims.sub)
        .order("data_vencimento", { ascending: false })
        .limit(24),
      db.from("manut_preventivas")
        .select("id,data_agendada,status")
        .eq("cliente_id", claims.sub)
        .gte("data_agendada", new Date(new Date().getFullYear(), 0, 1).toISOString()),
    ]);

    return jsonOk({
      cliente: clienteRes.data,
      pagamentos: pagamentosRes.data || [],
      visitasAno: visitasRes.data?.length || 0,
    });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" || e.message === "Token inválido" ? 401 : 500, e.message);
  }
};
