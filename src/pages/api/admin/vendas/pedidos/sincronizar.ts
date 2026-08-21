import type { APIRoute } from "astro";
import { requireAdminCookie, temPerfil, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";
import { importarPedidosML } from "../../../../../lib/mlPedidos";

export const prerender = false;
const PERFIS = ["admin"];

// POST → o botão "Buscar vendas agora" da tela /admin/vendas/pedidos.
//
// Pedido dela, 21/08/2026: "assim que eu receba mensagem de que algo foi
// vendido, eu consiga apertar e esse botão trazer as informações pro meu
// painel. Pois, preciso saber os custos do produto para não pagar errado."
//
// Só LÊ do Mercado Livre e grava na tabela. Não compra, não paga, não mexe no
// que a tela já marcou como comprado. A janela padrão é de 7 dias — cobre
// qualquer atraso sem varrer o histórico a cada clique.
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");

    const body = await request.json().catch(() => ({}));
    const dias = Math.min(Math.max(Number(body.dias) || 7, 1), 60);

    const db = supabaseAdmin();
    const resumo = await importarPedidosML(db, dias);

    await registrarAcao(db, { req: request, admin }, {
      acao: "editar",
      entidade: "vendas_pedidos",
      descricao:
        `Buscou vendas do ML pelo portal (${dias} dias): ${resumo.lidas} lida(s), ` +
        `${resumo.novas} nova(s), ${resumo.atualizadas} atualizada(s)`,
      dados: { erros: resumo.erros, sem_custo: resumo.semCusto.length },
    }).catch(() => {});

    return jsonOk({ ok: true, resumo });
  } catch (e: any) {
    if (e?.message === "Não autenticado") return jsonErr(401, e.message);
    // A mensagem vai inteira para a tela de propósito: quando isto falha, o
    // motivo é sempre acionável (token revogado, permissão de Pedidos, env
    // faltando) e ela precisa saber qual dos três é.
    return jsonErr(500, e?.message || "Erro inesperado ao buscar as vendas");
  }
};
