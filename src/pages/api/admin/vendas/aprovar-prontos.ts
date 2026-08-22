import type { APIRoute } from "astro";
import { requireAdminCookie, temPerfil, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";
import { registrarAcao } from "../../../../lib/auditoria";
import { lerTudo } from "../../../../lib/paginado";

export const prerender = false;
const PERFIS = ["admin"];

// POST → aprova de uma vez todos os candidatos que JÁ estão prontos.
//
// Por que existe (05/08/2026): a varredura do catálogo completo da TrazPraCa
// trouxe 117 produtos novos de uma vez, e o status é um seletor por linha.
// Aprovar 91 anúncios na mão não é trabalho de gente. O botão faz exatamente
// o que ela faria, só que numa tacada — e continua sendo o clique DELA que
// autoriza. Essa é a regra que não muda: o robô nunca decide o que entra na
// loja, só executa o que foi aprovado.
//
// Só toca em quem está `candidato` E `pronto_para_publicar`. Produto com
// pendência (sem foto, sem peso, sem atributo obrigatório) continua parado,
// de propósito — publicar quebrado é pior do que não publicar.
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");

    const db = supabaseAdmin();
    // 21/08/2026: sem paginar, aprovava no máximo 1.000 por clique e ninguém
    // via que tinha sobrado gente de fora (o teto do PostgREST é silencioso).
    const prontos = await lerTudo<{ id: string; sku_trazpraca: string | null }>((de, ate) =>
      db.from("vendas_produtos")
        .select("id, sku_trazpraca")
        .eq("status", "candidato")
        .eq("pronto_para_publicar", true)
        .range(de, ate),
    );
    if (prontos.length === 0) return jsonOk({ ok: true, aprovados: 0 });

    const ids = prontos.map((p: any) => p.id);
    const { error } = await db
      .from("vendas_produtos")
      .update({ status: "aprovado", updated_at: new Date().toISOString() })
      .in("id", ids);
    if (error) return jsonErr(400, error.message);

    await registrarAcao(db, { req: request, admin }, {
      acao: "editar",
      entidade: "vendas_produtos",
      registro_id: null,
      descricao: `Aprovou ${ids.length} produto(s) prontos de uma vez`,
      dados: { skus: prontos.map((p: any) => p.sku_trazpraca).slice(0, 300) },
    }).catch(() => {});

    return jsonOk({ ok: true, aprovados: ids.length });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
