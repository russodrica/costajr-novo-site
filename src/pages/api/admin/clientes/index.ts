import type { APIRoute } from "astro";
import { requireAdminCookie, hashSenha, gerarSenhaInicial, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";
import { registrarAcao } from "../../../../lib/auditoria";

export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
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

    await registrarAcao(db, { req: request, admin }, {
      acao: "criar",
      entidade: "manut_clientes",
      registro_id: data?.id ?? null,
      descricao: `Criou cliente "${nome}"`,
      dados: data,
    });

    return jsonOk({ ...data, senha_inicial: senhaFinal }, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
