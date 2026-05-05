import type { APIRoute } from "astro";
import { requireAdmin, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";
import { criarPreference } from "~/lib/mercadopago";

export const prerender = false;

export const POST: APIRoute = async ({ request, params }) => {
  try {
    await requireAdmin(request);
    const id = params.id!;
    const body = await request.json().catch(() => ({}));

    const { data: cli } = await supabaseAdmin()
      .from("manut_clientes")
      .select("id,nome,email,codigo,valor_mensal_contratado,plano_selecionado")
      .eq("id", id)
      .maybeSingle();

    if (!cli) return jsonErr(404, "Cliente não encontrado");

    const valor = body.valor ? Number(body.valor) : Number(cli.valor_mensal_contratado || 0);
    const descricao = body.descricao || cli.plano_selecionado || "Plano Manutenção Predial";

    if (!valor || valor <= 0) return jsonErr(400, "Valor inválido. Edite o cliente e defina o valor mensal antes de gerar o link.");

    const externalRef = `CJR-MANUT-LINK-${cli.id}-${Date.now()}`;
    const result = await criarPreference({
      cliente: { id: cli.id, email: cli.email, nome: cli.nome },
      plano: { nome: descricao, valor },
      externalReference: externalRef
    });

    if (!result.ok || !result.initPoint) {
      return jsonErr(502, result.motivo || "Mercado Pago não retornou link");
    }

    return jsonOk({ linkPagamento: result.initPoint });
  } catch (e: any) {
    return jsonErr(e.message === "Não autorizado" ? 401 : 500, e.message);
  }
};
