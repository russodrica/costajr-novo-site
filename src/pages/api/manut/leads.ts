import type { APIRoute } from "astro";
import { jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";

export const prerender = false;

// Public endpoint — salva/atualiza lead durante o fluxo de contratação.
// Upsert por email: se já existe, atualiza etapa e dados.
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { nome, nome_loja, email, telefone, plano, valor, etapa, observacoes } = body;

    if (!email) return jsonErr(400, "email obrigatório");

    const db = supabaseAdmin();

    // Verifica se já existe lead com esse email
    const { data: existente } = await db
      .from("manut_leads")
      .select("id, etapa")
      .eq("email", email.toLowerCase().trim())
      .maybeSingle();

    const etapas = ["novo", "contato_feito", "proposta_enviada", "negociando", "convertido", "perdido"];
    const etapaAtual = existente?.etapa || "novo";
    const novaEtapa = etapa || etapaAtual;

    if (existente) {
      const { data, error } = await db
        .from("manut_leads")
        .update({
          nome: nome || undefined,
          nome_loja: nome_loja || undefined,
          telefone: telefone || undefined,
          plano: plano || undefined,
          valor: valor || undefined,
          etapa: novaEtapa,
          observacoes: observacoes || undefined,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existente.id)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return jsonOk({ id: existente.id, updated: true });
    }

    const { data, error } = await db
      .from("manut_leads")
      .insert({
        nome: nome || "Desconhecido",
        nome_loja,
        email: email.toLowerCase().trim(),
        telefone,
        plano,
        valor,
        etapa: novaEtapa,
        observacoes,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return jsonOk({ id: data.id, created: true });
  } catch (e: any) {
    return jsonErr(500, e.message);
  }
};
