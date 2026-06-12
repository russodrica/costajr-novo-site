import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";

export const prerender = false;

// GET /api/admin/rh/documentos?colaborador_id=&tipo=&vencendo=30
export const GET: APIRoute = async ({ request, url }) => {
  try {
    await requireAdminCookie(request);
    const db = supabaseAdmin();
    let q = db.from("rh_documentos").select("*, rh_colaboradores(nome)").order("created_at", { ascending: false }).limit(1000);

    const colaboradorId = url.searchParams.get("colaborador_id");
    const tipo = url.searchParams.get("tipo");
    const vencendo = url.searchParams.get("vencendo");

    if (colaboradorId) q = q.eq("colaborador_id", colaboradorId);
    if (tipo && tipo !== "todos") q = q.eq("tipo", tipo);
    if (vencendo) {
      const dias = parseInt(vencendo, 10);
      if (!isNaN(dias) && dias > 0) {
        const hoje = new Date().toISOString().slice(0, 10);
        const limite = new Date(Date.now() + dias * 86400000).toISOString().slice(0, 10);
        q = q.gte("validade", hoje).lte("validade", limite).order("validade", { ascending: true });
      }
    }

    const { data, error } = await q;
    if (error) return jsonErr(500, error.message);
    return jsonOk(data || []);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// POST /api/admin/rh/documentos — cria documento
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const body = await request.json();
    if (!body.colaborador_id || !body.titulo) return jsonErr(400, "Colaborador e título são obrigatórios");

    const campos = ["colaborador_id", "titulo", "tipo", "url", "validade", "observacoes"];
    const row: Record<string, unknown> = { criado_por: admin.email };
    for (const c of campos) if (body[c] !== undefined && body[c] !== "") row[c] = body[c];

    const db = supabaseAdmin();
    const { data, error } = await db.from("rh_documentos").insert(row).select().single();
    if (error) return jsonErr(400, error.message);
    return jsonOk(data, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
