import type { APIRoute } from "astro";
import { requireAdminCookie, hashSenha, gerarSenhaInicial, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";

export const prerender = false;

export const POST: APIRoute = async ({ request, params }) => {
  try {
    await requireAdminCookie(request);
    const db = supabaseAdmin();
    const leadId = params.id!;

    // Busca o lead
    const { data: lead, error: errLead } = await db
      .from("manut_leads")
      .select("*")
      .eq("id", leadId)
      .single();
    if (errLead || !lead) return jsonErr(404, "Lead não encontrado");

    // Gera código único
    const codigo = "CLI-" + Math.floor(100000 + Math.random() * 900000);

    // Senha inicial gerada automaticamente
    const senhaInicial = gerarSenhaInicial();
    const senha_hash = await hashSenha(senhaInicial);

    // Cria o cliente
    const { data: cliente, error: errCliente } = await db
      .from("manut_clientes")
      .insert({
        nome: lead.nome,
        codigo,
        email: lead.email.toLowerCase().trim(),
        senha_hash,
        telefone: lead.telefone || null,
        plano_selecionado: lead.plano || null,
        valor_mensal_contratado: lead.valor || null,
        data_contratacao: new Date().toISOString(),
        status: "pendente",
      })
      .select()
      .single();
    if (errCliente) return jsonErr(400, errCliente.message);

    // Cria a loja automaticamente com os dados do lead
    let loja = null;
    if (lead.nome_loja) {
      const { data: lojaData } = await db
        .from("manut_lojas")
        .insert({
          cliente_id: cliente.id,
          nome: lead.nome_loja,
          status: "pendente",
        })
        .select()
        .single();
      loja = lojaData;
    }

    // Remove o lead convertido
    await db.from("manut_leads").delete().eq("id", leadId);

    return jsonOk({ cliente, loja, senha_inicial: senhaInicial }, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
