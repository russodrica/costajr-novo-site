import type { APIRoute } from "astro";
import { requireCliente, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";
import { enviarEmailVisitaAdicionalAdmin } from "~/lib/mailer";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const claims = await requireCliente(request);
    const { lojaId, dataDesejada, motivo } = await request.json();
    if (!lojaId || !dataDesejada) return jsonErr(400, "lojaId e dataDesejada obrigatórios");

    const db = supabaseAdmin();

    // Valida saldo de visitas adicionais
    const { data: cliente } = await db
      .from("manut_clientes")
      .select("id,nome,visitas_adicionais_disponiveis")
      .eq("id", claims.sub)
      .maybeSingle();
    if (!cliente) return jsonErr(404, "Cliente não encontrado");
    const disp = Number(cliente.visitas_adicionais_disponiveis || 0);
    if (disp <= 0) return jsonErr(400, "Você não tem visitas adicionais disponíveis no seu plano");

    // Verifica loja pertence ao cliente
    const { data: loja } = await db
      .from("manut_lojas")
      .select("id,nome,cliente_id,tecnico_vinculado_id")
      .eq("id", lojaId)
      .maybeSingle();
    if (!loja || loja.cliente_id !== claims.sub) return jsonErr(400, "Loja inválida");

    // Cria preventiva tipo "adicional" agendada
    const { data: preventiva, error } = await db
      .from("manut_preventivas")
      .insert({
        loja_id: lojaId,
        cliente_id: claims.sub,
        tecnico_atribuido_id: loja.tecnico_vinculado_id || null,
        data_agendada: new Date(dataDesejada).toISOString(),
        status: "agendada",
        tipo_visita: "adicional",
        solicitada_pelo_cliente: true,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    // Decrementa saldo
    await db
      .from("manut_clientes")
      .update({ visitas_adicionais_disponiveis: disp - 1 })
      .eq("id", claims.sub);

    // Email admin (não bloqueia)
    try {
      await enviarEmailVisitaAdicionalAdmin({
        clienteNome: cliente.nome,
        lojaNome: loja.nome,
        dataDesejada: new Date(dataDesejada).toLocaleDateString("pt-BR"),
        preventivaId: preventiva.id,
      });
    } catch (e: any) {
      console.warn("[visita-adicional] email falhou:", e?.message);
    }

    return jsonOk({ ok: true, preventiva, visitas_restantes: disp - 1 });
  } catch (e: any) {
    return jsonErr(400, e.message);
  }
};
