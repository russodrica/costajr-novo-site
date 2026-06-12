import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { jsonOk, jsonErr } from "~/lib/auth";

export const prerender = false;

// GET /api/admissao/[token] — endpoint PÚBLICO (candidato acessa pelo link).
// Retorna apenas dados básicos. NUNCA expõe storage_path nem dados de terceiros.
export const GET: APIRoute = async ({ params }) => {
  try {
    const db = supabaseAdmin();
    const { data: adm } = await db
      .from("rh_admissoes")
      .select("id, nome, email, telefone, cargo, regime, status")
      .eq("token", params.token!)
      .maybeSingle();
    if (!adm) return jsonErr(404, "Link de admissão não encontrado");

    const { data: docs } = await db
      .from("rh_admissoes_docs")
      .select("tipo, nome_arquivo, created_at")
      .eq("admissao_id", adm.id)
      .order("created_at", { ascending: true });

    return jsonOk({
      nome: adm.nome,
      email: adm.email,
      telefone: adm.telefone,
      cargo: adm.cargo,
      regime: adm.regime,
      status: adm.status,
      docs: docs || [],
    });
  } catch (e: any) {
    return jsonErr(500, e.message);
  }
};
