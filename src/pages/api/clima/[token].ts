import type { APIRoute } from "astro";
import { jsonOk, jsonErr } from "../../../lib/auth";
import { supabaseAdmin } from "../../../lib/supabase";
import { DIMENSOES } from "../../../lib/clima";

export const prerender = false;

// GET /api/clima/[token] — info da pesquisa (pública, se ativa)
export const GET: APIRoute = async ({ params }) => {
  try {
    const db = supabaseAdmin();
    const { data } = await db.from("rh_clima_pesquisas").select("id, titulo, periodo, ativa").eq("token", params.token!).maybeSingle();
    if (!data) return jsonErr(404, "Pesquisa não encontrada.");
    if (!data.ativa) return jsonErr(410, "Esta pesquisa foi encerrada.");
    return jsonOk({ titulo: data.titulo, periodo: data.periodo, dimensoes: DIMENSOES });
  } catch (e: any) {
    return jsonErr(500, e.message);
  }
};

// POST /api/clima/[token] — registra a resposta ANÔNIMA (sem login)
export const POST: APIRoute = async ({ request, params }) => {
  try {
    const db = supabaseAdmin();
    const { data: p } = await db.from("rh_clima_pesquisas").select("id, ativa").eq("token", params.token!).maybeSingle();
    if (!p) return jsonErr(404, "Pesquisa não encontrada.");
    if (!p.ativa) return jsonErr(410, "Esta pesquisa foi encerrada.");
    const body = await request.json();
    const enps = Number(body.enps);
    const respostas: Record<string, number> = {};
    for (const d of DIMENSOES) { const n = Number(body.respostas?.[d.k]); if (!isNaN(n) && n >= 1 && n <= 5) respostas[d.k] = n; }
    const { error } = await db.from("rh_clima_respostas").insert({
      pesquisa_id: p.id,
      enps: !isNaN(enps) && enps >= 0 && enps <= 10 ? enps : null,
      respostas, comentario: (body.comentario || "").slice(0, 2000) || null,
    });
    if (error) return jsonErr(400, error.message);
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(500, e.message);
  }
};
