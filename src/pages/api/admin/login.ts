import type { APIRoute } from "astro";
import { signToken, hashSenha, jsonOk, jsonErr } from "../../../lib/auth";
import { supabaseAdmin } from "../../../lib/supabase";
import { clientIp, rateLimit } from "../../../lib/ratelimit";
import { STEPUP_ATIVO, lerDeviceCookie, novoDeviceCookie, deviceConfiavel, tocarDevice, criarDesafioOtp, TD_COOKIE } from "../../../lib/stepup";

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const { email, senha } = await request.json();
    if (!email || !senha) return jsonErr(400, "Email e senha obrigatórios");
    if (!(await rateLimit(`login:${clientIp(request)}`, 12, 600))) return jsonErr(429, "Muitas tentativas. Aguarde alguns minutos e tente novamente.");

    const db = supabaseAdmin();
    const { data: perfil, error } = await db
      .from("portal_profiles")
      .select("id, email, display_name, role, approval_status, senha_hash, senha_troca_obrigatoria, token_version")
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

    // Verificação de novo dispositivo (step-up): só liga com STEPUP_ENABLED=1.
    // FAIL-OPEN: qualquer erro aqui cai no login normal (nunca trava o acesso).
    if (STEPUP_ATIVO) {
      try {
        let tdId = await lerDeviceCookie(request);
        if (!(await deviceConfiavel(perfil.id, tdId))) {
          if (!tdId) {
            const nd = await novoDeviceCookie();
            tdId = nd.tdId;
            cookies.set(TD_COOKIE, nd.cookieValue, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 400 * 24 * 3600, secure: import.meta.env.PROD });
          }
          const desafio = await criarDesafioOtp({ profileId: perfil.id, nome: perfil.display_name || perfil.email, email: perfil.email, tdId, ip: clientIp(request) });
          return jsonOk({ step: "otp", challenge_id: desafio.challengeId, canal: desafio.canal, destino: desafio.destino });
        }
        await tocarDevice(perfil.id, tdId!, clientIp(request), "");
      } catch (e: any) {
        console.error("[stepup] fail-open admin/login:", e?.message);
      }
    }

    const token = await signToken({ sub: perfil.id, tipo: "admin", email: perfil.email, role: perfil.role, tv: typeof perfil.token_version === "number" ? perfil.token_version : 0 });

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
