import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";

export const prerender = false;

const TIPOS_DOC = ["contrato", "aso", "ficha_epi", "advertencia", "atestado", "certificado", "cnh", "outro"];

// GET /api/admin/rh/documentos?colaborador_id=&tipo=&vencendo=30&vencidos=1
export const GET: APIRoute = async ({ request, url }) => {
  try {
    await requireAdminCookie(request);
    const db = supabaseAdmin();
    let q = db.from("rh_documentos").select("*, rh_colaboradores(nome)").order("created_at", { ascending: false }).limit(1000);

    const colaboradorId = url.searchParams.get("colaborador_id");
    const tipo = url.searchParams.get("tipo");
    const vencendo = url.searchParams.get("vencendo");
    const vencidos = url.searchParams.get("vencidos");

    if (colaboradorId) q = q.eq("colaborador_id", colaboradorId);
    if (tipo && tipo !== "todos") q = q.eq("tipo", tipo);
    const hoje = new Date().toISOString().slice(0, 10);
    if (vencidos === "1") {
      // documentos já vencidos (validade < hoje)
      q = q.not("validade", "is", null).lt("validade", hoje).order("validade", { ascending: true });
    } else if (vencendo) {
      const dias = parseInt(vencendo, 10);
      if (!isNaN(dias) && dias > 0) {
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
    if (body.tipo && !TIPOS_DOC.includes(body.tipo)) return jsonErr(400, "Tipo de documento inválido");

    const campos = ["colaborador_id", "titulo", "tipo", "url", "validade", "validade_na", "observacoes"];
    const row: Record<string, unknown> = { criado_por: admin.email };
    for (const c of campos) if (body[c] !== undefined && body[c] !== "") row[c] = body[c];

    const db = supabaseAdmin();
    const { data, error } = await db.from("rh_documentos").insert(row).select().single();
    if (error) return jsonErr(400, error.message);
    await registrarAcao(db, { req: request, admin }, {
      acao: "criar",
      entidade: "rh_documentos",
      registro_id: data?.id ?? null,
      descricao: `Criou documento RH "${body.titulo}"`,
      dados: data,
    });
    return jsonOk(data, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
