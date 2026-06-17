import type { APIRoute } from "astro";
import { signToken, jsonOk, jsonErr } from "../../../lib/auth";
import { supabaseAdmin } from "../../../lib/supabase";
import { clientIp } from "../../../lib/ratelimit";
import { lerDeviceCookie, verificarOtp } from "../../../lib/stepup";

export const prerender = false;

// POST /api/admin/login-otp — 2º passo do login quando o dispositivo é novo.
// Body: { challenge_id, code }. Valida o código, confia no dispositivo por 30 dias
// e emite a sessão (mesmo token/cookie do /api/admin/login).
export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const { challenge_id, code } = await request.json();
    if (!challenge_id || !code) return jsonErr(400, "Informe o código recebido.");

    const tdId = await lerDeviceCookie(request);
    if (!tdId) return jsonErr(400, "Sessão de verificação expirada. Faça o login novamente.");

    const ua = request.headers.get("user-agent") || "";
    const r = await verificarOtp(String(challenge_id), String(code), tdId, clientIp(request), "", ua);
    if (!r.ok) return jsonErr(r.status, r.erro);

    const db = supabaseAdmin();
    const { data: perfil } = await db
      .from("portal_profiles")
      .select("id, email, display_name, role, roles, tem_trabalhista, approval_status, senha_troca_obrigatoria, token_version")
      .eq("id", r.profileId)
      .single();
    if (!perfil || perfil.approval_status !== "approved") return jsonErr(403, "Acesso não aprovado.");

    const perfis = ((perfil.roles && perfil.roles.length) ? perfil.roles : [perfil.role]).filter(Boolean);
    const token = await signToken({
      sub: perfil.id, tipo: "admin", email: perfil.email, role: perfil.role, roles: perfis,
      trabalhista: !!perfil.tem_trabalhista,
      tv: typeof perfil.token_version === "number" ? perfil.token_version : 0,
    });
    await db.from("portal_profiles").update({ last_login_at: new Date().toISOString() }).eq("id", perfil.id);
    cookies.delete("admin_token", { path: "/", domain: ".costajr.com.br" });
    cookies.set("admin_token", token, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 8, secure: import.meta.env.PROD });

    return jsonOk({ ok: true, token, nome: perfil.display_name || perfil.email, role: perfil.role, roles: perfis, troca: !!perfil.senha_troca_obrigatoria });
  } catch (e: any) {
    return jsonErr(500, e?.message || "Erro interno.");
  }
};
