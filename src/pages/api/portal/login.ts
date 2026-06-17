import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { signToken, hashSenha, jsonOk, jsonErr } from "~/lib/auth";
import { clientIp, rateLimit } from "~/lib/ratelimit";

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const { email, senha } = await request.json();
    if (!email || !senha) return jsonErr(400, "E-mail e senha são obrigatórios.");
    if (!(await rateLimit(`login:${clientIp(request)}`, 12, 600))) return jsonErr(429, "Muitas tentativas. Aguarde alguns minutos e tente novamente.");

    const sb = supabaseAdmin();
    const { data: profile, error } = await sb
      .from("portal_profiles")
      .select("id, email, display_name, full_name, role, roles, tem_trabalhista, avatar_url, approval_status, senha_hash, senha_troca_obrigatoria, token_version")
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
      tv: typeof profile.token_version === "number" ? profile.token_version : 0,
    });

    await sb.from("portal_profiles").update({ last_login_at: new Date().toISOString() }).eq("id", profile.id);

    // Login único: além de devolver o token (compat com o localStorage antigo), seta o
    // cookie admin_token — o mesmo do /admin/login. Assim quem entra pela tela do portal
    // já sai autenticado no painel unificado /admin (mesmo token, tipo:"admin").
    cookies.delete("admin_token", { path: "/", domain: ".costajr.com.br" });
    cookies.set("admin_token", token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 8,
      secure: import.meta.env.PROD,
    });

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
