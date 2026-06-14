import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { jsonOk, jsonErr } from "~/lib/auth";
import { DISC_GRUPOS, ENEAGRAMA_ITENS, calcularDisc, calcularEneagrama, DISC_DESC, ENEAGRAMA_DESC, type DiscDim } from "~/lib/testes";

export const prerender = false;

// GET /api/teste/[token] — devolve nome do candidato + perguntas (ou o resultado, se já respondeu)
export const GET: APIRoute = async ({ params }) => {
  try {
    const db = supabaseAdmin();
    const { data: cand } = await db.from("rh_candidatos")
      .select("nome, teste_respondido_em, teste_disc, teste_eneagrama")
      .eq("teste_token", params.token!).maybeSingle();
    if (!cand) return jsonErr(404, "Link inválido ou expirado.");
    return jsonOk({
      nome: cand.nome,
      respondido: !!cand.teste_respondido_em,
      resultado: cand.teste_respondido_em ? { disc: cand.teste_disc, eneagrama: cand.teste_eneagrama } : null,
      disc_grupos: DISC_GRUPOS,
      eneagrama_itens: ENEAGRAMA_ITENS.map((it, i) => ({ i, t: it.t })),
    });
  } catch (e: any) {
    return jsonErr(500, e.message);
  }
};

// POST /api/teste/[token] — recebe respostas, calcula e salva no candidato
export const POST: APIRoute = async ({ request, params }) => {
  try {
    const db = supabaseAdmin();
    const { data: cand } = await db.from("rh_candidatos").select("id, nome, teste_respondido_em").eq("teste_token", params.token!).maybeSingle();
    if (!cand) return jsonErr(404, "Link inválido ou expirado.");
    if (cand.teste_respondido_em) return jsonErr(400, "Este teste já foi respondido. Obrigado!");

    const body = await request.json().catch(() => ({}));
    const discResp: Record<string, DiscDim> = body.disc || {};
    const eneaResp: Record<string, number> = body.eneagrama || {};

    // validação básica de completude
    if (Object.keys(discResp).length < DISC_GRUPOS.length) return jsonErr(400, "Responda todas as questões do DISC.");
    if (Object.keys(eneaResp).length < ENEAGRAMA_ITENS.length) return jsonErr(400, "Responda todas as afirmações do Eneagrama.");

    const disc = calcularDisc(discResp);
    const enea = calcularEneagrama(eneaResp);

    const { error } = await db.from("rh_candidatos").update({
      teste_disc: disc.sigla,
      teste_eneagrama: enea.nome,
      teste_disc_detalhe: { ...disc, descricao: DISC_DESC[disc.dominante] },
      teste_eneagrama_detalhe: { ...enea, descricao: ENEAGRAMA_DESC[enea.tipo] },
      teste_respondido_em: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", cand.id);
    if (error) return jsonErr(400, error.message);

    return jsonOk({
      ok: true,
      disc: { sigla: disc.sigla, descricao: DISC_DESC[disc.dominante] },
      eneagrama: { nome: enea.nome, descricao: ENEAGRAMA_DESC[enea.tipo] },
    });
  } catch (e: any) {
    return jsonErr(500, e.message);
  }
};
