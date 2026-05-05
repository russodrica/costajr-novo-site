import type { APIRoute } from "astro";
import { requireAdminCookie, gerarSenhaInicial, hashSenha, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";

export const POST: APIRoute = async ({ request, params }) => {
  try {
    await requireAdminCookie(request);
    const senha = gerarSenhaInicial();
    const senha_hash = await hashSenha(senha);
    const db = supabaseAdmin();
    const { error } = await db.from("manut_clientes").update({ senha_hash, senha_troca_obrigatoria: true }).eq("id", params.id!);
    if (error) return jsonErr(400, error.message);
    return jsonOk({ senha });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
