import type { APIRoute } from "astro";
import { requireAdminCookie, hashSenha, gerarSenhaInicial, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";
import { registrarAcao } from "../../../../lib/auditoria";

export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const { display_name, email, role, senha } = await request.json();
    if (!display_name || !email || !role) return jsonErr(400, "display_name, email e role são obrigatórios");
    const senhaFinal = senha || gerarSenhaInicial();
    const senha_hash = await hashSenha(senhaFinal);
    const db = supabaseAdmin();
    const { data, error } = await db.from("portal_profiles").insert({
      display_name, email: email.toLowerCase().trim(), role,
      approval_status: "approved", senha_hash, senha_troca_obrigatoria: !senha,
    }).select().single();
    if (error) return jsonErr(400, error.message);
    await registrarAcao(db, { req: request, admin }, {
      acao: "criar",
      entidade: "portal_profiles",
      registro_id: data?.id ?? null,
      descricao: `Criou membro "${display_name}" (${email.toLowerCase().trim()}) com perfil ${role}`,
      dados: { display_name, email: email.toLowerCase().trim(), role, approval_status: "approved" },
    });
    return jsonOk({ ...data, senha_inicial: senhaFinal }, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
