import type { APIRoute } from "astro";
import { requireCliente, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";

export const prerender = false;

function gerarCodigo(prefix: string): string {
  const r = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}${r}`;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const claims = await requireCliente(request);
    const db = supabaseAdmin();

    // Reusa cupom de nova-loja existente do cliente se houver ativo (uso 0)
    const { data: existente } = await db
      .from("manut_cupons")
      .select("codigo")
      .eq("cliente_dono_id", claims.sub)
      .eq("tipo", "nova_loja")
      .eq("ativo", true)
      .eq("usos_atuais", 0)
      .limit(1)
      .maybeSingle();
    if (existente) return jsonOk({ codigo: existente.codigo, reusado: true });

    let codigo = gerarCodigo("NLOJA-");
    // Garante unicidade
    for (let i = 0; i < 5; i++) {
      const { data: dup } = await db.from("manut_cupons").select("codigo").eq("codigo", codigo).maybeSingle();
      if (!dup) break;
      codigo = gerarCodigo("NLOJA-");
    }

    const { error } = await db.from("manut_cupons").insert({
      codigo,
      descricao: "Adicionar nova loja (cliente existente)",
      desconto_percentual: 5,
      duracao_meses: 1,
      usos_maximos: 1,
      cliente_dono_id: claims.sub,
      tipo: "nova_loja",
      ativo: true,
    });
    if (error) throw new Error(error.message);
    return jsonOk({ codigo, reusado: false });
  } catch (e: any) {
    return jsonErr(400, e.message);
  }
};
