import type { APIRoute } from "astro";
import { requireAdminCookie, temPerfil, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";
import { registrarAcao } from "../../../../lib/auditoria";

export const prerender = false;
const PERFIS = ["admin"];

// PATCH → marca o que aconteceu com o pedido no fornecedor.
//
// Por que só isto, e nada de comprar (11/08/2026): a ponte que o Bling fazia
// morreu em 21/06 e a venda de 08/08 ficou sem pedido. O robô agora traz a
// venda do Mercado Livre inteira — cliente, CPF, endereço, produto — e deixa
// pronta para cadastrar na TrazPraCa. Mas cadastrar e PAGAR é dinheiro saindo
// da carteira dela: isso é ato da Adriana, não do portal. Este endpoint só
// registra o que ela já fez, para o alerta parar de tocar e o pedido sair da
// fila.
//
// Estados possíveis:
//   comprado       ela cadastrou e pagou na TrazPraCa
//   nao_aplicavel  venda cancelada, ou produto que não vem da TrazPraCa
//   a_comprar      desfaz (errou o clique)
const ESTADOS = ["a_comprar", "comprado", "nao_aplicavel"];

export const PATCH: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");

    const body = await request.json().catch(() => ({}));
    const id = String(body.id || "");
    const estado = String(body.fornecedor_status || "");
    if (!id) return jsonErr(400, "Falta o id do pedido");
    if (!ESTADOS.includes(estado)) return jsonErr(400, `Estado inválido: ${estado}`);

    const patch: Record<string, any> = {
      fornecedor_status: estado,
      updated_at: new Date().toISOString(),
    };
    if (estado === "comprado") {
      patch.comprado_em = new Date().toISOString();
      patch.comprado_por = admin.email || "admin";
    } else {
      patch.comprado_em = null;
      patch.comprado_por = null;
    }
    if (body.fornecedor_pedido !== undefined) {
      patch.fornecedor_pedido = String(body.fornecedor_pedido || "").trim() || null;
    }
    if (body.observacao !== undefined) {
      patch.observacao = String(body.observacao || "").trim() || null;
    }

    const db = supabaseAdmin();
    const { data, error } = await db
      .from("vendas_pedidos")
      .update(patch)
      .eq("id", id)
      .select("id, pedido_canal, fornecedor_status")
      .single();
    if (error) return jsonErr(400, error.message);

    // Marcar como comprado apaga o alerta que estava tocando — deixar o alerta
    // aberto depois da compra feita ensina a ignorar alerta, que é pior do que
    // não ter alerta nenhum.
    if (estado !== "a_comprar" && data?.pedido_canal) {
      await db
        .from("vendas_alertas")
        .update({ resolvido: true, resolvido_em: new Date().toISOString() })
        .eq("tipo", "pedido_a_comprar")
        .eq("resolvido", false)
        .like("mensagem", `%${data.pedido_canal}%`)
        .then(() => {}, () => {});
    }

    await registrarAcao(db, { req: request, admin }, {
      acao: "editar",
      entidade: "vendas_pedidos",
      registro_id: id,
      descricao: `Pedido ${data?.pedido_canal || id}: ${estado}`,
      dados: { fornecedor_pedido: patch.fornecedor_pedido || null },
    }).catch(() => {});

    return jsonOk({ ok: true, pedido: data });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
