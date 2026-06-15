import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { requireAdmin, jsonOk, jsonErr } from "~/lib/auth";

export const prerender = false;

// GET /api/portal/meu-rh — dados de RH do PRÓPRIO colaborador logado (autoatendimento).
// Resolve o login (portal_profiles.id = claims.sub) -> pessoa do RH via profile_id.
export const GET: APIRoute = async ({ request }) => {
  try {
    const claims = await requireAdmin(request);
    const sb = supabaseAdmin();
    const { data: colab } = await sb.from("rh_colaboradores")
      .select("id, nome, cargo, setor, regime, status, data_admissao, data_nascimento, email, email_pessoal, telefone, telefone_pessoal, endereco, cidade, uf")
      .eq("profile_id", claims.sub).maybeSingle();
    if (!colab) return jsonOk({ vinculado: false });

    const [docs, periodos, parcelas, epis] = await Promise.all([
      sb.from("rh_documentos").select("id, titulo, tipo, validade, validade_na, storage_path, url, created_at").eq("colaborador_id", colab.id).order("created_at", { ascending: false }),
      sb.from("rh_ferias_periodos").select("id, inicio_aquisitivo, fim_aquisitivo, limite_concessivo, dias_direito, dias_abono, status").eq("colaborador_id", colab.id).order("inicio_aquisitivo", { ascending: false }),
      sb.from("rh_ferias_parcelas").select("id, periodo_id, data_inicio, data_fim, dias, status").eq("colaborador_id", colab.id).order("data_inicio", { ascending: true }),
      sb.from("epi_entregas").select("id, epi, ca, tamanho, data_entrega, data_validade, status").eq("colaborador_id", colab.id).eq("status", "ativo").order("epi"),
    ]);

    const porPeriodo: Record<string, any[]> = {};
    for (const p of parcelas.data || []) (porPeriodo[p.periodo_id] = porPeriodo[p.periodo_id] || []).push(p);
    const ferias = (periodos.data || []).map((pr: any) => ({ ...pr, parcelas: porPeriodo[pr.id] || [] }));

    return jsonOk({
      vinculado: true,
      colaborador: colab,
      documentos: docs.data || [],
      ferias,
      epis: epis.data || [],
    });
  } catch {
    return jsonErr(401, "Não autenticado.");
  }
};
