import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";
import { notaGeral } from "../../../../../lib/avaliacoes";

export const prerender = false;

// GET /api/admin/rh/avaliacoes?ano=&trimestre=&colaborador_id=
export const GET: APIRoute = async ({ request, url }) => {
  try {
    await requireAdminCookie(request);
    const db = supabaseAdmin();
    let q = db.from("rh_avaliacoes").select("*").order("created_at", { ascending: false }).limit(3000);
    const ano = url.searchParams.get("ano");
    const tri = url.searchParams.get("trimestre");
    const cid = url.searchParams.get("colaborador_id");
    if (ano) q = q.eq("ano", parseInt(ano, 10));
    if (tri) q = q.eq("trimestre", parseInt(tri, 10));
    if (cid) q = q.eq("colaborador_id", cid);
    const { data, error } = await q;
    if (error) return jsonErr(500, error.message);
    return jsonOk(data || []);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// POST — salva/atualiza a avaliação (upsert por colaborador+ano+trimestre+tipo)
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const body = await request.json();
    if (!body.colaborador_id || !body.ano || !body.trimestre) return jsonErr(400, "Colaborador, ano e trimestre são obrigatórios.");
    const respostas = body.respostas || {};
    const row = {
      colaborador_id: body.colaborador_id, ano: parseInt(body.ano, 10), trimestre: parseInt(body.trimestre, 10),
      tipo: body.tipo === "autoavaliacao" ? "autoavaliacao" : "gestor",
      avaliador_email: admin.email, avaliador_nome: body.avaliador_nome || admin.email,
      respostas, nota_geral: notaGeral(respostas),
      pontos_fortes: body.pontos_fortes || null, pontos_desenvolver: body.pontos_desenvolver || null, metas_pdi: body.metas_pdi || null,
      status: "concluida", criado_por: admin.email, updated_at: new Date().toISOString(),
    };
    const db = supabaseAdmin();
    const { data, error } = await db.from("rh_avaliacoes").upsert(row, { onConflict: "colaborador_id,ano,trimestre,tipo" }).select().single();
    if (error) return jsonErr(400, error.message);
    await registrarAcao(db, { req: request, admin }, { acao: "criar", entidade: "rh_avaliacoes", registro_id: data.id, descricao: `Avaliou desempenho (T${row.trimestre}/${row.ano}, nota ${row.nota_geral})`, dados: { colaborador_id: row.colaborador_id, nota: row.nota_geral } });
    return jsonOk(data);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
