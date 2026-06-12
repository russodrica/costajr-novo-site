import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { requireAdmin, jsonOk, jsonErr } from "~/lib/auth";

export const prerender = false;

// POST /api/portal/termos/[id]/aceitar — aceite digital do termo de responsabilidade.
// Registra data/hora e IP. Só o próprio colaborador pode aceitar o termo dele.
export const POST: APIRoute = async ({ request, params, clientAddress }) => {
  try {
    const claims = await requireAdmin(request);
    const sb = supabaseAdmin();

    const { data: termo } = await sb.from("ativos_termos").select("*").eq("id", params.id!).maybeSingle();
    if (!termo) return jsonErr(404, "Termo não encontrado");
    if (termo.colaborador_id !== claims.sub) return jsonErr(403, "Este termo não pertence a você");
    if (termo.status === "aceito") return jsonOk(termo);
    if (termo.status === "cancelado") return jsonErr(400, "Termo cancelado");

    let ip = "";
    try { ip = clientAddress || ""; } catch { /* clientAddress pode lançar em prerender */ }
    if (!ip) ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "";

    const { data, error } = await sb.from("ativos_termos").update({
      status: "aceito",
      aceito_em: new Date().toISOString(),
      aceito_ip: ip || null,
    }).eq("id", params.id!).select().single();
    if (error) return jsonErr(400, error.message);

    // registra o aceite na linha do tempo do ativo
    await sb.from("ativos_movimentos").insert({
      ativo_id: termo.ativo_id,
      tipo: "mudanca_status",
      descricao: `Termo de responsabilidade aceito eletronicamente por ${termo.colaborador_nome}`,
      dados: { termo_id: termo.id, aceito_ip: ip },
      feito_por: claims.email || termo.colaborador_nome,
    });

    return jsonOk(data);
  } catch {
    return jsonErr(401, "Não autenticado.");
  }
};
