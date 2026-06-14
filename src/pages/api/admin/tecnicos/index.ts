import type { APIRoute } from "astro";
import { requireAdminCookie, hashSenha, gerarSenhaInicial, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";
import { sincronizarLojasDoTecnico } from "../../../../lib/manut/tecnicos";
import { registrarAcao } from "../../../../lib/auditoria";

export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const { nome, email, cpf, telefone, especialidades, senha, lojas } = await request.json();
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

    if (Array.isArray(lojas) && lojas.length) {
      await sincronizarLojasDoTecnico(data.id, lojas);
    }

    await registrarAcao(db, { req: request, admin }, {
      acao: "criar",
      entidade: "manut_tecnicos",
      registro_id: data.id,
      descricao: `Criou técnico "${nome}"`,
      dados: data,
    });

    return jsonOk({ ...data, senha_inicial: senhaFinal, lojas: lojas || [] }, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
