import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";

export const prerender = false;

const TIPOS_VALIDOS = new Set(["desconto", "indicacao", "nova_loja", "representante"]);

export const POST: APIRoute = async ({ request }) => {
  try {
    await requireAdminCookie(request);
    const body = await request.json();

    const codigo = String(body.codigo || "").trim().toUpperCase();
    const desconto = Number(body.desconto_percentual);
    const tipo = String(body.tipo || "desconto");
    const cashbackPct = Number(body.cashback_pct || 0);
    const duracaoMeses = Math.max(1, parseInt(String(body.duracao_meses || 1)));

    if (!codigo) return jsonErr(400, "Código obrigatório");
    if (!desconto || desconto <= 0 || desconto > 100) return jsonErr(400, "Desconto deve ser entre 1 e 100");
    if (!TIPOS_VALIDOS.has(tipo)) return jsonErr(400, "Tipo de cupom inválido");
    if (cashbackPct < 0 || cashbackPct > 100) return jsonErr(400, "Cashback % deve estar entre 0 e 100");
    if (duracaoMeses < 1 || duracaoMeses > 36) return jsonErr(400, "Duração deve ser entre 1 e 36 meses");

    const db = supabaseAdmin();

    // Verifica duplicidade de código
    const { data: dup } = await db.from("manut_cupons").select("id").eq("codigo", codigo).maybeSingle();
    if (dup) return jsonErr(409, "Código já existe");

    // Resolve dono conforme tipo
    let cliente_dono_id: string | null = null;
    let representante_id: string | null = null;

    if (tipo === "indicacao") {
      const email = String(body.cliente_dono_email || "").trim().toLowerCase();
      if (!email) return jsonErr(400, "Email do cliente indicador é obrigatório para cupom de indicação");
      const { data: cli } = await db.from("manut_clientes").select("id").ilike("email", email).maybeSingle();
      if (!cli) return jsonErr(404, `Nenhum cliente encontrado com email ${email}`);
      cliente_dono_id = cli.id;
      // Se cashback > 0, exigimos que o dono seja diferente de quem usa (validado na hora do uso).
    } else if (tipo === "representante") {
      const repId = String(body.representante_id || "");
      if (!repId) return jsonErr(400, "Representante é obrigatório para cupom de representante");
      const { data: rep } = await db.from("manut_representantes").select("id, ativo").eq("id", repId).maybeSingle();
      if (!rep) return jsonErr(404, "Representante não encontrado");
      if (!rep.ativo) return jsonErr(400, "Representante está inativo — reative antes de criar cupom");
      representante_id = repId;
      if (cashbackPct <= 0) {
        // Não bloqueia — pode ser um cupom de representante sem comissão (apenas pra rastrear quem indicou),
        // mas avisar via log seria útil. Por ora aceitamos.
      }
    }

    const { data, error } = await db.from("manut_cupons").insert({
      codigo,
      descricao: body.descricao || null,
      desconto_percentual: desconto,
      duracao_meses: duracaoMeses,
      usos_maximos: body.usos_maximos ? Number(body.usos_maximos) : null,
      validade: body.validade ? new Date(body.validade).toISOString() : null,
      tipo,
      cashback_pct: cashbackPct,
      cliente_dono_id,
      representante_id,
      ativo: true,
    }).select("*").single();

    if (error) throw new Error(error.message);
    return jsonOk(data, 201);
  } catch (e: any) {
    const code = e.message === "Não autenticado" ? 401 : 400;
    return jsonErr(code, e.message);
  }
};
