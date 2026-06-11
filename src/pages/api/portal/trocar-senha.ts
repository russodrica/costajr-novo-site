import type { APIRoute } from "astro";
import {
  getPortalToken,
  getAdminTokenFromCookie,
  verifyToken,
  hashSenha,
  jsonOk,
  jsonErr,
  type AdminClaims,
} from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";

export const prerender = false;

// Autentica tanto o admin (cookie admin_token) quanto o colaborador
// (header x-portal-auth). Ambos são perfis em portal_profiles.
async function autenticar(request: Request): Promise<AdminClaims> {
  const headerTok = getPortalToken(request);
  const cookieTok = getAdminTokenFromCookie(request);
  const tok = headerTok || cookieTok;
  if (!tok) throw new Error("Não autenticado");
  const claims = await verifyToken<AdminClaims>(tok);
  if (claims.tipo !== "admin") throw new Error("Token inválido");
  return claims;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const claims = await autenticar(request);
    const { senhaAtual, novaSenha } = await request.json();
    if (!senhaAtual || !novaSenha) return jsonErr(400, "Informe a senha atual e a nova senha.");
    if (String(novaSenha).length < 6) return jsonErr(400, "A nova senha deve ter ao menos 6 caracteres.");
    if (senhaAtual === novaSenha) return jsonErr(400, "A nova senha deve ser diferente da atual.");

    const db = supabaseAdmin();
    const { data: perfil, error } = await db
      .from("portal_profiles")
      .select("id, senha_hash")
      .eq("id", claims.sub)
      .single();
    if (error || !perfil) return jsonErr(404, "Usuário não encontrado.");

    const hashAtual = await hashSenha(senhaAtual);
    if (hashAtual !== perfil.senha_hash) return jsonErr(401, "Senha atual incorreta.");

    await db
      .from("portal_profiles")
      .update({ senha_hash: await hashSenha(novaSenha), senha_troca_obrigatoria: false })
      .eq("id", perfil.id);

    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" || e.message === "Token inválido" ? 401 : 500, e.message);
  }
};
