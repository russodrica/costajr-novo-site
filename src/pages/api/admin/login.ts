import type { APIRoute } from "astro";
import { signToken, hashSenha, jsonOk, jsonErr } from "../../../lib/auth";
import { supabaseAdmin } from "../../../lib/supabase";

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const { email, senha } = await request.json();
    if (!email || !senha) return jsonErr(400, "Email e senha obrigatórios");

    const db = supabaseAdmin();
    const { data: perfil, error } = await db
      .from("portal_profiles")
      .select("id, email, display_name, role, approval_status, senha_hash, senha_troca_obrigatoria")
      .eq("email", email.toLowerCase().trim())
      .single();

    if (error || !perfil) return jsonErr(401, "Credenciais inválidas");
    if (perfil.approval_status !== "approved") return jsonErr(403, "Acesso não aprovado");
    if (!["admin", "manutencao_operacao", "manutencao_administrativo", "operacional", "rh", "financeiro", "comercial", "juridico", "coordenador"].includes(perfil.role)) {
      return jsonErr(403, "Sem permissão de acesso");
    }
    if (!perfil.senha_hash) return jsonErr(401, "Senha não configurada. Contate o administrador.");

    const inputHash = await hashSenha(senha);
    if (inputHash !== perfil.senha_hash) return jsonErr(401, "Credenciais inválidas");

    const token = await signToken({ sub: perfil.id, tipo: "admin", email: perfil.email, role: perfil.role });

    // Atualiza last_login
    await db.from("portal_profiles").update({ last_login_at: new Date().toISOString() }).eq("id", perfil.id);

    // Remove um possível cookie-ponte antigo (escopo de domínio, do RH embutido no
    // portal) para que ele não sombreie esta sessão de admin recém-criada.
    cookies.delete("admin_token", { path: "/", domain: ".costajr.com.br" });

    cookies.set("admin_token", token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 8, // 8h
      secure: import.meta.env.PROD,
    });

    return jsonOk({ ok: true, nome: perfil.display_name, role: perfil.role, troca: !!perfil.senha_troca_obrigatoria });
  } catch (e: any) {
    return jsonErr(500, e.message);
  }
};
