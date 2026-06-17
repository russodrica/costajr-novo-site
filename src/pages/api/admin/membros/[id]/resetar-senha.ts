import type { APIRoute } from "astro";
import { requireAdminCookie, gerarSenhaInicial, hashSenha, invalidarSessoesPortal, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { bloqueioSeSoLeitura } from "../../../../../lib/permissoes";
import { enviarSenhaReset } from "../../../../../lib/mailer";

export const POST: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const ro = await bloqueioSeSoLeitura(admin, "membros"); if (ro) return ro;
    const senha = gerarSenhaInicial();
    const senha_hash = await hashSenha(senha);
    const db = supabaseAdmin();
    const { data: mem, error } = await db
      .from("portal_profiles")
      .update({ senha_hash, senha_troca_obrigatoria: true })
      .eq("id", params.id!)
      .select("email,display_name,full_name")
      .single();
    if (error) return jsonErr(400, error.message);

    // Reset de senha mata QUALQUER sessão ativa do usuário (ex.: conta comprometida).
    await invalidarSessoesPortal(params.id!);

    const nome = mem.display_name || mem.full_name || "Colaborador";
    let emailEnviado = false;
    let emailErro: string | undefined;
    try {
      await enviarSenhaReset(mem.email, nome, senha, "/portal/login");
      emailEnviado = true;
    } catch (e: any) {
      console.error("[mailer][admin-reset-membro]", e.message);
      emailErro = e.message;
    }
    return jsonOk({ senha, emailEnviado, emailErro });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
