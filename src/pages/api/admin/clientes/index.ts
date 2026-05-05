import type { APIRoute } from "astro";
import { requireAdminCookie, hashSenha, gerarSenhaInicial, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";

export const POST: APIRoute = async ({ request }) => {
  try {
    await requireAdminCookie(request);
    const body = await request.json();
    const { nome, codigo, email, senha, telefone, cnpj_cpf, plano_selecionado, valor_mensal_contratado } = body;
    if (!nome || !codigo || !email) return jsonErr(400, "nome, codigo e email são obrigatórios");

    const senhaFinal = senha || gerarSenhaInicial();
    const senha_hash = await hashSenha(senhaFinal);

    const db = supabaseAdmin();
    const { data, error } = await db.from("manut_clientes").insert({
      nome, codigo, email: email.toLowerCase().trim(), senha_hash,
      telefone: telefone || null, cnpj_cpf: cnpj_cpf || null,
      plano_selecionado: plano_selecionado || null,
      valor_mensal_contratado: valor_mensal_contratado || null,
      status: "pendente",
    }).select().single();

    if (error) return jsonErr(400, error.message);
    return jsonOk({ ...data, senha_inicial: senhaFinal }, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
