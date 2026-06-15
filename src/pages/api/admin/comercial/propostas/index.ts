import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";
import { bloqueioSeSoLeitura } from "../../../../../lib/permissoes";

export const prerender = false;

const STATUS = ["rascunho", "enviada", "aceita", "recusada", "expirada"];
const CAMPOS = ["lead_id", "cliente_nome", "titulo", "valor", "status", "url_pdf", "valido_ate", "observacoes"];

// GET /api/admin/comercial/propostas?status=
export const GET: APIRoute = async ({ request, url }) => {
  try {
    await requireAdminCookie(request);
    const db = supabaseAdmin();
    let q = db
      .from("com_propostas")
      .select("*, manut_leads(nome)")
      .order("created_at", { ascending: false })
      .limit(500);

    const status = url.searchParams.get("status");
    if (status && status !== "todos") q = q.eq("status", status);

    const { data, error } = await q;
    if (error) return jsonErr(500, error.message);
    return jsonOk(data || []);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// POST /api/admin/comercial/propostas — cria proposta
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const _ro = await bloqueioSeSoLeitura(admin, "comercial"); if (_ro) return _ro;
    const body = await request.json();

    if (!body.cliente_nome || !body.titulo) return jsonErr(400, "Cliente e título são obrigatórios");
    if (body.status !== undefined && !STATUS.includes(body.status)) return jsonErr(400, "Status inválido");

    const row: Record<string, unknown> = { criado_por: admin.email };
    for (const c of CAMPOS) if (body[c] !== undefined && body[c] !== "") row[c] = body[c];

    const db = supabaseAdmin();
    const { data, error } = await db.from("com_propostas").insert(row).select().single();
    if (error) return jsonErr(400, error.message);

    await registrarAcao(db, { req: request, admin }, {
      acao: "criar",
      entidade: "com_propostas",
      registro_id: data?.id ?? null,
      descricao: `Criou proposta "${body.titulo}" para ${body.cliente_nome}`,
      dados: data,
    });

    return jsonOk(data, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
