import type { APIRoute } from "astro";
import { jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";

export const prerender = false;

// Endpoint público — valida cupom sem autenticação.
// Incrementa usos_atuais apenas quando o contrato é confirmado (etapa 5).
export const GET: APIRoute = async ({ url }) => {
  try {
    const codigo = url.searchParams.get("codigo");
    if (!codigo) return jsonErr(400, "codigo obrigatório");

    const { data } = await supabaseAdmin()
      .from("manut_cupons")
      .select("id, codigo, descricao, desconto_percentual, duracao_meses, usos_maximos, usos_atuais, validade, ativo")
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

    return jsonOk({
      valido: true,
      id: data.id,
      codigo: data.codigo,
      descricao: data.descricao,
      desconto_percentual: Number(data.desconto_percentual),
      duracao_meses: data.duracao_meses,
    });
  } catch (e: any) {
    return jsonErr(500, e.message);
  }
};
