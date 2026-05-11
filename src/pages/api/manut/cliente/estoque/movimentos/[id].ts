import type { APIRoute } from "astro";
import { requireCliente, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";
import { solicitarReposicao } from "~/lib/manut/estoque";

export const prerender = false;

// POST — cliente solicita reposição de um movimento (baixa/adição)
// Body: { action: "solicitar" }
export const POST: APIRoute = async ({ request, params }) => {
  try {
    const claims = await requireCliente(request);
    const body = await request.json();
    if (body.action !== "solicitar") return jsonErr(400, "action inválida");

    // Confere que o movimento é de uma loja do cliente
    const db = supabaseAdmin();
    const { data: mov } = await db
      .from("manut_estoque_movimentos")
      .select("id,loja_id,manut_lojas(cliente_id)")
      .eq("id", params.id!)
      .single();
    if (!mov || (mov.manut_lojas as any)?.cliente_id !== claims.sub) {
      return jsonErr(403, "Movimento não pertence a você");
    }

    const result = await solicitarReposicao(params.id!);
    return jsonOk(result);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" || e.message === "Token inválido" ? 401 : 500, e.message);
  }
};
