import type { APIRoute } from "astro";
import { requireCliente, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";

export const prerender = false;

function gerarCodigoIndicacao(nome: string): string {
  const base = String(nome || "CLIENTE")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6) || "CJR";
  const sufixo = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${base}${sufixo}`;
}

export const GET: APIRoute = async ({ request }) => {
  try {
    const claims = await requireCliente(request);
    const db = supabaseAdmin();

    const { data: cli } = await db
      .from("manut_clientes")
      .select("id,nome,saldo_cashback")
      .eq("id", claims.sub)
      .maybeSingle();
    if (!cli) return jsonErr(404, "Cliente não encontrado");

    // Cupom de indicação (cria se não existir)
    let { data: cupom } = await db
      .from("manut_cupons")
      .select("codigo,usos_atuais,desconto_percentual,cashback_pct")
      .eq("cliente_dono_id", claims.sub)
      .eq("tipo", "indicacao")
      .maybeSingle();

    if (!cupom) {
      let codigo = gerarCodigoIndicacao(cli.nome);
      for (let i = 0; i < 5; i++) {
        const { data: dup } = await db.from("manut_cupons").select("codigo").eq("codigo", codigo).maybeSingle();
        if (!dup) break;
        codigo = gerarCodigoIndicacao(cli.nome);
      }
      const { data: novo } = await db.from("manut_cupons").insert({
        codigo,
        descricao: `Indicação de ${cli.nome}`,
        desconto_percentual: 5,
        cashback_pct: 5,
        duracao_meses: 1,
        cliente_dono_id: claims.sub,
        tipo: "indicacao",
        ativo: true,
      }).select("codigo,usos_atuais,desconto_percentual,cashback_pct").single();
      cupom = novo;
    }

    const { data: movimentos } = await db
      .from("manut_cashback_movimentos")
      .select("*")
      .eq("cliente_id", claims.sub)
      .order("created_at", { ascending: false })
      .limit(50);

    return jsonOk({
      saldo: Number(cli.saldo_cashback || 0),
      cupom,
      movimentos: movimentos || [],
    });
  } catch (e: any) {
    return jsonErr(401, e.message);
  }
};
