import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";
import { DIMENSOES, calcularEnps } from "../../../../../lib/clima";
import { bloqueioSeSoLeitura } from "../../../../../lib/permissoes";

export const prerender = false;

// GET /api/admin/rh/clima — pesquisas + resultado agregado (eNPS, médias, comentários)
export const GET: APIRoute = async ({ request }) => {
  try {
    await requireAdminCookie(request);
    const db = supabaseAdmin();
    const { data: pesquisas } = await db.from("rh_clima_pesquisas").select("*").order("created_at", { ascending: false }).limit(200);
    const ids = (pesquisas || []).map((p: any) => p.id);
    let respostas: any[] = [];
    if (ids.length) { const { data } = await db.from("rh_clima_respostas").select("*").in("pesquisa_id", ids).limit(20000); respostas = data || []; }
    const out = (pesquisas || []).map((p: any) => {
      const rs = respostas.filter((r) => r.pesquisa_id === p.id);
      const enps = calcularEnps(rs.map((r) => r.enps).filter((n) => n != null));
      const dimMed: Record<string, number> = {};
      for (const d of DIMENSOES) {
        const vals = rs.map((r) => Number(r.respostas?.[d.k])).filter((n) => !isNaN(n) && n > 0);
        dimMed[d.k] = vals.length ? Math.round((vals.reduce((s, n) => s + n, 0) / vals.length) * 100) / 100 : 0;
      }
      const comentarios = rs.map((r) => r.comentario).filter(Boolean);
      return { ...p, respostas: rs.length, enps, dimMed, comentarios };
    });
    return jsonOk({ pesquisas: out, dimensoes: DIMENSOES });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// POST — cria uma campanha de pesquisa
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const _ro = await bloqueioSeSoLeitura(admin, "clima"); if (_ro) return _ro;
    const body = await request.json();
    if (!body.titulo) return jsonErr(400, "Título é obrigatório.");
    const db = supabaseAdmin();
    const { data, error } = await db.from("rh_clima_pesquisas").insert({ titulo: body.titulo, periodo: body.periodo || null, criado_por: admin.email }).select().single();
    if (error) return jsonErr(400, error.message);
    await registrarAcao(db, { req: request, admin }, { acao: "criar", entidade: "rh_clima_pesquisas", registro_id: data.id, descricao: `Criou pesquisa de clima "${data.titulo}"`, dados: data });
    return jsonOk(data, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
