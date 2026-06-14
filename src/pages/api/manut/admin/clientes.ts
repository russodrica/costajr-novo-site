import type { APIRoute } from "astro";
import { requireAdmin, jsonOk, jsonErr, hashSenha, gerarSenhaInicial } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";
import { registrarAcao } from "~/lib/auditoria";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    await requireAdmin(request);
    const { data, error } = await supabaseAdmin()
      .from("manut_clientes")
      .select("id,nome,email,codigo,status,plano_selecionado,valor_mensal_contratado,visitas_contratadas,data_contratacao,data_proximo_vencimento,telefone,cnpj_cpf")
      .order("data_contratacao", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return jsonOk(data || []);
  } catch (e: any) {
    return jsonErr(e.message === "Não autorizado" ? 401 : 500, e.message);
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdmin(request);
    const body = await request.json();
    const { nome, email, telefone, plano_selecionado, valor_mensal_contratado, visitas_contratadas } = body;
    if (!nome || !email) return jsonErr(400, "nome e email obrigatórios");

    const db = supabaseAdmin();
    const { data: dup } = await db.from("manut_clientes").select("id").eq("email", email.toLowerCase().trim()).maybeSingle();
    if (dup) return jsonErr(409, "Email já cadastrado");

    const senhaInicial = gerarSenhaInicial();
    const codigo = "CLI-" + String(Date.now()).slice(-6);

    const { data, error } = await db.from("manut_clientes").insert({
      nome,
      email: email.toLowerCase().trim(),
      codigo,
      telefone: telefone || null,
      status: "pendente",
      senha_hash: await hashSenha(senhaInicial),
      senha_troca_obrigatoria: true,
      plano_selecionado: plano_selecionado || null,
      valor_mensal_contratado: valor_mensal_contratado ? Number(valor_mensal_contratado) : null,
      visitas_contratadas: visitas_contratadas ? Number(visitas_contratadas) : 1,
      data_contratacao: new Date().toISOString(),
    }).select("id,codigo,nome,email,status").single();

    if (error) throw new Error(error.message);

    await registrarAcao(db, { req: request, admin }, {
      acao: "criar",
      entidade: "manut_clientes",
      registro_id: data?.id ?? null,
      descricao: `Criou cliente "${nome}" (${codigo})`,
      dados: { id: data?.id, nome, email: email.toLowerCase().trim(), codigo, telefone: telefone || null, plano_selecionado: plano_selecionado || null, valor_mensal_contratado: valor_mensal_contratado ? Number(valor_mensal_contratado) : null, visitas_contratadas: visitas_contratadas ? Number(visitas_contratadas) : 1 },
    });

    return jsonOk({ ...data, senhaInicial });
  } catch (e: any) {
    return jsonErr(e.message === "Não autorizado" ? 401 : e.message.includes("409") ? 409 : 500, e.message);
  }
};
