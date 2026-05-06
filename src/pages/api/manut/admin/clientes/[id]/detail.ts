import type { APIRoute } from "astro";
import { requireAdmin, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";

export const prerender = false;

export const GET: APIRoute = async ({ request, params }) => {
  try {
    await requireAdmin(request);
    const { id } = params;
    if (!id) return jsonErr(400, "id obrigatório");

    const db = supabaseAdmin();
    const [resCh, resPrev, resOrc, resLojas] = await Promise.all([
      db.from("manut_chamados")
        .select("id, tipo, status, prioridade, data_abertura, descricao, manut_lojas(nome, cidade), manut_tecnicos(nome)")
        .eq("cliente_id", id)
        .order("data_abertura", { ascending: false })
        .limit(50),
      db.from("manut_preventivas")
        .select("id, data_agendada, status, manut_lojas(id, nome), manut_tecnicos(id, nome)")
        .eq("cliente_id", id)
        .order("data_agendada", { ascending: false })
        .limit(50),
      db.from("manut_orcamentos")
        .select("id, descricao_solicitacao, valor, status, created_at, proposta_pdf_url, manut_lojas(nome)")
        .eq("cliente_id", id)
        .order("created_at", { ascending: false })
        .limit(50),
      db.from("manut_lojas")
        .select("id, nome, cidade, uf, status")
        .eq("cliente_id", id)
        .order("nome"),
    ]);

    return jsonOk({
      chamados: resCh.data || [],
      preventivas: resPrev.data || [],
      orcamentos: resOrc.data || [],
      lojas: resLojas.data || [],
    });
  } catch (e: any) {
    return jsonErr(e.message === "Não autorizado" ? 401 : 500, e.message);
  }
};
