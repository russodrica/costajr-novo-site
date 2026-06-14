import type { APIRoute } from "astro";
import { requireAdmin, jsonOk, jsonErr, hashSenha, gerarSenhaInicial } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";
import { registrarAcao } from "~/lib/auditoria";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    await requireAdmin(request);
    const { data } = await supabaseAdmin()
      .from("manut_tecnicos")
      .select("id,nome,email,telefone,especialidades,lojas_ids,status,last_login_at,created_at")
      .order("nome");
    return jsonOk(data || []);
  } catch (e: any) {
    return jsonErr(e.message === "Não autorizado" ? 401 : 500, e.message);
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdmin(request);
    const body = await request.json();
    const { nome, email, telefone, especialidades } = body;
    if (!nome || !email) return jsonErr(400, "nome e email obrigatórios");

    const senhaInicial = gerarSenhaInicial();
    const { data, error } = await supabaseAdmin()
      .from("manut_tecnicos")
      .insert({
        nome,
        email: email.toLowerCase().trim(),
        telefone: telefone || null,
        especialidades: especialidades || [],
        senha_hash: await hashSenha(senhaInicial),
        senha_troca_obrigatoria: true,
        status: "ativo",
      })
      .select("id,nome,email,telefone,especialidades,status,created_at")
      .single();

    if (error) throw new Error(error.message);

    await registrarAcao(supabaseAdmin(), { req: request, admin }, {
      acao: "criar",
      entidade: "manut_tecnicos",
      registro_id: data?.id ?? null,
      descricao: `Criou técnico "${data?.nome || nome}"`,
      dados: data,
    });

    return jsonOk({ ...data, senhaInicial });
  } catch (e: any) {
    return jsonErr(e.message === "Não autorizado" ? 401 : 500, e.message);
  }
};
