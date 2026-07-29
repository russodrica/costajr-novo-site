import type { APIRoute } from "astro";
import {
  getPortalToken,
  getAdminTokenFromCookie,
  verifyToken,
  perfisDe,
  hashSenha,
  jsonOk,
  jsonErr,
  type AdminClaims,
} from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";
import { registrarAcao } from "~/lib/auditoria";

export const prerender = false;

// Troca de senha AUTO-SERVIÇO do FORNECEDOR externo (e SÓ dele). Endpoint isolado
// (fora de /api/admin) e liberado por UMA entrada explícita na cerca do middleware.
// Só altera a PRÓPRIA senha (claims.sub); nunca toca outra conta nem outro recurso.
export const POST: APIRoute = async ({ request }) => {
  try {
    const tok = getPortalToken(request) || getAdminTokenFromCookie(request);
    if (!tok) return jsonErr(401, "Não autenticado");
    let claims: AdminClaims;
    try { claims = await verifyToken<AdminClaims>(tok); } catch { return jsonErr(401, "Sessão inválida"); }
    if (claims.tipo !== "admin" || !perfisDe(claims).includes("fornecedor")) return jsonErr(403, "Sem permissão");

    const { senhaAtual, novaSenha } = await request.json().catch(() => ({}));
    if (!senhaAtual || !novaSenha) return jsonErr(400, "Informe a senha provisória e a nova senha.");
    if (String(novaSenha).length < 8) return jsonErr(400, "A nova senha deve ter ao menos 8 caracteres.");
    if (senhaAtual === novaSenha) return jsonErr(400, "A nova senha deve ser diferente da provisória.");

    const db = supabaseAdmin();
    const { data: perfil, error } = await db
      .from("portal_profiles")
      .select("id, senha_hash, role")
      .eq("id", claims.sub)
      .single();
    if (error || !perfil) return jsonErr(404, "Usuário não encontrado.");
    if (perfil.role !== "fornecedor") return jsonErr(403, "Sem permissão"); // trava dupla: só fornecedor

    if ((await hashSenha(senhaAtual)) !== perfil.senha_hash) return jsonErr(401, "Senha provisória incorreta.");

    const { error: e2 } = await db
      .from("portal_profiles")
      .update({ senha_hash: await hashSenha(novaSenha), senha_troca_obrigatoria: false })
      .eq("id", perfil.id);
    if (e2) return jsonErr(400, e2.message);

    await registrarAcao(db, { req: request, admin: { email: claims.email, role: "fornecedor" } }, {
      acao: "editar", entidade: "fornecedor_acesso", registro_id: perfil.id,
      descricao: "Fornecedor definiu a própria senha pessoal (troca da provisória)",
    }).catch(() => {});

    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(500, e.message);
  }
};
