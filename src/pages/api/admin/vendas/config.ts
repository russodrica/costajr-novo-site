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
  "margem_minima_pct",
  "reajuste_max_pct",
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
  margem_minima_pct: { min: 1, max: 90, rotulo: "Margem mínima" },
  reajuste_max_pct: { min: 0, max: 100, rotulo: "Teto de reajuste automático" },
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

    // marca_padrao é texto — não passa pelo laço numérico acima.
    const patchTexto: Record<string, string> = {};
    if (typeof b.marca_padrao === "string") {
      const m = b.marca_padrao.trim();
      if (!m) return jsonErr(400, "A marca padrão não pode ficar vazia — o Mercado Livre exige o campo Marca.");
      if (m.length > 60) return jsonErr(400, "A marca padrão deve ter no máximo 60 caracteres.");
      patchTexto.marca_padrao = m;
    }

    if (!Object.keys(patch).length && !Object.keys(patchTexto).length) {
      return jsonErr(400, "Nada para atualizar.");
    }

    // Comissão + margem alvo >= 100% torna qualquer preço impossível de atingir.
    const db = supabaseAdmin();
    const { data: atual } = await db.from("vendas_config").select("*").eq("id", "default").maybeSingle();
    const comissao = patch.ml_comissao_pct ?? Number(atual?.ml_comissao_pct ?? 13);
    const margem = patch.margem_alvo_pct ?? Number(atual?.margem_alvo_pct ?? 30);
    if (comissao + margem >= 100) {
      return jsonErr(400, `Comissão (${comissao}%) + margem alvo (${margem}%) precisa somar menos de 100%, senão nenhum preço atinge a meta.`);
    }

    // Regra da Adriana: o piso pode ser menor que o alvo, mas NUNCA zero — um
    // preço sem margem só queima capital de giro e ainda consome o saldo da
    // carteira da TrazPraCa. E piso acima do alvo não faz sentido nenhum.
    const minima = patch.margem_minima_pct ?? Number(atual?.margem_minima_pct ?? 15);
    if (minima <= 0) {
      return jsonErr(400, "A margem mínima não pode ser zero. Ela é o piso que impede vender sem lucro.");
    }
    if (minima > margem) {
      return jsonErr(400, `A margem mínima (${minima}%) não pode ser maior que a margem alvo (${margem}%).`);
    }
    if (comissao + minima >= 100) {
      return jsonErr(400, `Comissão (${comissao}%) + margem mínima (${minima}%) precisa somar menos de 100%.`);
    }

    const { error } = await db.from("vendas_config")
      .update({ ...patch, ...patchTexto, updated_at: new Date().toISOString() })
      .eq("id", "default");
    if (error) return jsonErr(400, error.message);

    await registrarAcao(db, { req: request, admin }, {
      acao: "editar", entidade: "vendas_config", registro_id: "default",
      descricao: `Atualizou taxas/margem de Vendas: ${Object.entries({ ...patch, ...patchTexto }).map(([k, v]) => `${k}=${v}`).join(", ")}`,
    }).catch(() => {});

    return jsonOk({ ok: true, config: { ...patch, ...patchTexto } });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
