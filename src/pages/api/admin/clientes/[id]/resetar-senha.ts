import type { APIRoute } from "astro";
import { requireAdminCookie, gerarSenhaInicial, hashSenha, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { enviarSenhaReset } from "../../../../../lib/mailer";

export const POST: APIRoute = async ({ request, params }) => {
  try {
    await requireAdminCookie(request);
    const senha = gerarSenhaInicial();
    const senha_hash = await hashSenha(senha);
    const db = supabaseAdmin();
    const { data: cli, error } = await db
      .from("manut_clientes")
      .update({ senha_hash, senha_troca_obrigatoria: true })
      .eq("id", params.id!)
      .select("email,nome")
      .single();
    if (error) return jsonErr(400, error.message);

    let emailEnviado = false;
    let emailErro: string | undefined;
    try {
      await enviarSenhaReset(cli.email, cli.nome ?? "Cliente", senha);
      emailEnviado = true;
    } catch (e: any) {
      console.error("[mailer][admin-reset-cliente]", e.message);
      emailErro = e.message;
    }
    return jsonOk({ senha, emailEnviado, emailErro });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
