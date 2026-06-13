import type { APIRoute } from "astro";
import { requireAdminCookie, hashSenha, gerarSenhaInicial, jsonOk, jsonErr } from "../../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../../lib/supabase";
import { enviarSenhaTemporaria } from "../../../../../../lib/mailer";

export const prerender = false;

const ROLES = ["admin", "coordenador", "financeiro", "comercial", "rh", "operacional"];

// POST /api/admin/rh/colaboradores/[id]/acesso
// Dá acesso ao portal a um colaborador do RH: cria (ou vincula) um membro
// (portal_profiles), define o perfil e envia a senha temporária por e-mail.
// body: { role }  (perfil: admin, coordenador, financeiro, comercial, rh, operacional)
export const POST: APIRoute = async ({ request, params }) => {
  try {
    await requireAdminCookie(request);
    const { role } = await request.json();
    if (!role || !ROLES.includes(role)) return jsonErr(400, "Perfil inválido.");

    const db = supabaseAdmin();
    const { data: colab } = await db.from("rh_colaboradores").select("*").eq("id", params.id!).maybeSingle();
    if (!colab) return jsonErr(404, "Colaborador não encontrado");
    const email = String(colab.email || "").toLowerCase().trim();
    if (!email) return jsonErr(400, "O colaborador precisa ter um e-mail cadastrado para receber o acesso.");

    // já vinculado?
    if (colab.profile_id) {
      const { data: existe } = await db.from("portal_profiles").select("id").eq("id", colab.profile_id).maybeSingle();
      if (existe) return jsonErr(400, "Este colaborador já tem acesso ao portal.");
    }

    // se já existe um membro com esse e-mail, apenas VINCULA (não duplica)
    const { data: jaMembro } = await db.from("portal_profiles").select("id, role, roles").eq("email", email).maybeSingle();
    if (jaMembro) {
      await db.from("rh_colaboradores").update({ profile_id: jaMembro.id, updated_at: new Date().toISOString() }).eq("id", colab.id);
      // garante o perfil escolhido
      const roles = Array.isArray(jaMembro.roles) && jaMembro.roles.length ? Array.from(new Set([...jaMembro.roles, role])) : [role];
      await db.from("portal_profiles").update({ role, roles }).eq("id", jaMembro.id);
      return jsonOk({ vinculado: true, membro_id: jaMembro.id, novo: false });
    }

    // cria o membro
    const senha = gerarSenhaInicial();
    const senha_hash = await hashSenha(senha);
    const nome = colab.nome || email;
    const { data: membro, error } = await db.from("portal_profiles").insert({
      display_name: nome, full_name: nome, email, role, roles: [role],
      approval_status: "approved", senha_hash, senha_troca_obrigatoria: true,
    }).select().single();
    if (error) return jsonErr(400, error.message);

    await db.from("rh_colaboradores").update({ profile_id: membro.id, updated_at: new Date().toISOString() }).eq("id", colab.id);

    let emailEnviado = true;
    try { await enviarSenhaTemporaria(email, nome, senha, "/portal/login"); }
    catch { emailEnviado = false; }

    return jsonOk({ novo: true, membro_id: membro.id, email, senha_inicial: senha, email_enviado: emailEnviado }, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// DELETE /api/admin/rh/colaboradores/[id]/acesso — remove o vínculo (não apaga o membro)
export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    await requireAdminCookie(request);
    const db = supabaseAdmin();
    await db.from("rh_colaboradores").update({ profile_id: null, updated_at: new Date().toISOString() }).eq("id", params.id!);
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
