import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { signToken, hashSenha, jsonOk, jsonErr } from "~/lib/auth";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const { email, senha } = await request.json();
    if (!email || !senha) return jsonErr(400, "E-mail e senha são obrigatórios.");

    const sb = supabaseAdmin();
    const { data: profile, error } = await sb
      .from("portal_profiles")
      .select("id, email, display_name, full_name, role, roles, tem_trabalhista, avatar_url, approval_status, senha_hash, senha_troca_obrigatoria")
      .eq("email", email.toLowerCase().trim())
      .single();

    if (error || !profile) return jsonErr(401, "E-mail ou senha inválidos.");
    if (profile.approval_status !== "approved") return jsonErr(403, "Seu acesso ainda não foi aprovado. Fale com o RH.");

    const hash = await hashSenha(senha);
    if (hash !== profile.senha_hash) return jsonErr(401, "E-mail ou senha inválidos.");

    const perfis = (profile.roles && profile.roles.length ? profile.roles : [profile.role]).filter(Boolean);
    const token = await signToken({
      sub: profile.id,
      tipo: "admin",
      email: profile.email,
      role: profile.role,
      roles: perfis,
      trabalhista: !!profile.tem_trabalhista,
    });

    await sb.from("portal_profiles").update({ last_login_at: new Date().toISOString() }).eq("id", profile.id);

    return jsonOk({
      token,
      troca: !!profile.senha_troca_obrigatoria,
      user: {
        id: profile.id,
        email: profile.email,
        nome: profile.full_name || profile.display_name || profile.email,
        role: profile.role,
        roles: perfis,
        trabalhista: !!profile.tem_trabalhista,
        avatar_url: profile.avatar_url || null,
      },
    });
  } catch (err) {
    console.error("portal/login:", err);
    return jsonErr(500, "Erro interno.");
  }
};
