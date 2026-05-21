import type { APIRoute } from "astro";
import { jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";
import { REGRAS_INDICACAO_POR_DURACAO } from "~/lib/manut/indicacao-regras";

export const prerender = false;

// Endpoint público — valida cupom sem autenticação.
// Incrementa usos_atuais apenas quando o contrato é confirmado (etapa 5).
//
// Quando o cupom é do tipo 'representante', o cliente vê 1 código só (ex: MZ2601)
// mas as regras (desconto + duração + comissão) variam conforme a duração do plano
// escolhido. O endpoint devolve a tabela completa em `regrasPorDuracao` e o frontend
// decide qual aplicar.
export const GET: APIRoute = async ({ url }) => {
  try {
    const codigo = url.searchParams.get("codigo");
    if (!codigo) return jsonErr(400, "codigo obrigatório");

    const { data } = await supabaseAdmin()
      .from("manut_cupons")
      .select("id, codigo, descricao, desconto_percentual, duracao_meses, cashback_pct, tipo, usos_maximos, usos_atuais, validade, ativo")
      .eq("codigo", codigo.toUpperCase().trim())
      .eq("ativo", true)
      .maybeSingle();

    if (!data) return jsonOk({ valido: false, motivo: "nao_encontrado" });

    if (data.validade && new Date(data.validade) < new Date()) {
      return jsonOk({ valido: false, motivo: "expirado" });
    }

    if (data.usos_maximos && data.usos_atuais >= data.usos_maximos) {
      return jsonOk({ valido: false, motivo: "esgotado" });
    }

    const tipo = String(data.tipo || "desconto");
    const isRepresentante = tipo === "representante";

    return jsonOk({
      valido: true,
      id: data.id,
      codigo: data.codigo,
      descricao: data.descricao,
      tipo,
      // Valores "padrão" do registro — usados quando não é cupom de representante
      desconto_percentual: Number(data.desconto_percentual || 0),
      duracao_meses: Number(data.duracao_meses || 1),
      cashback_pct: Number(data.cashback_pct || 0),
      // Quando tipo='representante', o frontend usa esta tabela em vez dos valores acima:
      // a regra aplicada depende da duração do plano que o cliente escolher.
      regrasPorDuracao: isRepresentante ? REGRAS_INDICACAO_POR_DURACAO : null,
    });
  } catch (e: any) {
    return jsonErr(500, e.message);
  }
};
