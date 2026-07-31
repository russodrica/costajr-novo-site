import type { APIRoute } from "astro";
import { requireAdminCookie, temPerfil, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";
import { registrarAcao } from "../../../../lib/auditoria";

export const prerender = false;
const PERFIS = ["admin"];

// Campos numéricos editáveis pela tela. As faixas da Shopee (jsonb) ficam de
// fora de propósito: mexer nelas é raro e arriscado pela UI — se precisar,
// altera direto no banco.
const CAMPOS_NUM = [
  "ml_comissao_pct",
  "ml_custo_fixo",
  "ml_frete_estimado",
  "ml_limite_frete_gratis",
  "shopee_campanha_pct",
  "margem_alvo_pct",
] as const;

// Limites de sanidade — evita salvar valor que quebraria o cálculo
// (ex.: comissão de 200%, que deixaria toda margem impossível).
const LIMITES: Record<string, { min: number; max: number; rotulo: string }> = {
  ml_comissao_pct: { min: 0, max: 60, rotulo: "Comissão ML" },
  ml_custo_fixo: { min: 0, max: 200, rotulo: "Custo fixo ML" },
  ml_frete_estimado: { min: 0, max: 500, rotulo: "Frete estimado" },
  ml_limite_frete_gratis: { min: 0, max: 1000, rotulo: "Limite frete grátis" },
  shopee_campanha_pct: { min: 0, max: 30, rotulo: "Campanha Shopee" },
  margem_alvo_pct: { min: 0, max: 90, rotulo: "Margem alvo" },
};

// GET → configuração atual de taxas/margem
export const GET: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");

    const db = supabaseAdmin();
    const { data, error } = await db.from("vendas_config").select("*").eq("id", "default").maybeSingle();
    if (error) return jsonErr(400, error.message);
    return jsonOk({ config: data || null });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// PATCH → atualiza taxas e margem alvo
export const PATCH: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");

    const b = await request.json().catch(() => ({}));
    const patch: Record<string, number> = {};

    for (const campo of CAMPOS_NUM) {
      if (b[campo] === undefined || b[campo] === "") continue;
      const n = Number(b[campo]);
      if (!Number.isFinite(n)) return jsonErr(400, `Valor inválido em ${campo}.`);
      const lim = LIMITES[campo];
      if (n < lim.min || n > lim.max) {
        return jsonErr(400, `${lim.rotulo} deve ficar entre ${lim.min} e ${lim.max}.`);
      }
      patch[campo] = n;
    }

    if (!Object.keys(patch).length) return jsonErr(400, "Nada para atualizar.");

    // Comissão + margem alvo >= 100% torna qualquer preço impossível de atingir.
    const db = supabaseAdmin();
    const { data: atual } = await db.from("vendas_config").select("*").eq("id", "default").maybeSingle();
    const comissao = patch.ml_comissao_pct ?? Number(atual?.ml_comissao_pct ?? 13);
    const margem = patch.margem_alvo_pct ?? Number(atual?.margem_alvo_pct ?? 30);
    if (comissao + margem >= 100) {
      return jsonErr(400, `Comissão (${comissao}%) + margem alvo (${margem}%) precisa somar menos de 100%, senão nenhum preço atinge a meta.`);
    }

    const { error } = await db.from("vendas_config")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", "default");
    if (error) return jsonErr(400, error.message);

    await registrarAcao(db, { req: request, admin }, {
      acao: "editar", entidade: "vendas_config", registro_id: "default",
      descricao: `Atualizou taxas/margem de Vendas: ${Object.entries(patch).map(([k, v]) => `${k}=${v}`).join(", ")}`,
    }).catch(() => {});

    return jsonOk({ ok: true, config: patch });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
