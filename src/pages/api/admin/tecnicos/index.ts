import type { APIRoute } from "astro";
import { requireAdminCookie, hashSenha, gerarSenhaInicial, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";

export const POST: APIRoute = async ({ request }) => {
  try {
    await requireAdminCookie(request);
    const { nome, email, cpf, telefone, especialidades, senha } = await request.json();
    if (!nome || !email) return jsonErr(400, "nome e email são obrigatórios");
    const senhaFinal = senha || gerarSenhaInicial();
    const senha_hash = await hashSenha(senhaFinal);
    const db = supabaseAdmin();
    const { data, error } = await db.from("manut_tecnicos").insert({
      nome, email: email.toLowerCase().trim(), senha_hash,
      cpf: cpf || null, telefone: telefone || null,
      especialidades: especialidades || [],
      status: "ativo",
    }).select().single();
    if (error) return jsonErr(400, error.message);
    return jsonOk({ ...data, senha_inicial: senhaFinal }, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
