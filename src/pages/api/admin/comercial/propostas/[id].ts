import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { bloqueioSeSoLeitura } from "../../../../../lib/permissoes";

export const prerender = false;

const STATUS = ["rascunho", "enviada", "aceita", "recusada", "expirada"];
const CAMPOS = ["lead_id", "cliente_nome", "titulo", "valor", "status", "url_pdf", "valido_ate", "observacoes"];

// PATCH /api/admin/comercial/propostas/:id — atualiza proposta
export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const _ro = await bloqueioSeSoLeitura(admin, "comercial"); if (_ro) return _ro;
    const body = await request.json();

    if (body.status !== undefined && !STATUS.includes(body.status)) return jsonErr(400, "Status inválido");
    if (body.cliente_nome === "") return jsonErr(400, "Cliente é obrigatório");
    if (body.titulo === "") return jsonErr(400, "Título é obrigatório");

    const row: Record<string, unknown> = {};
    for (const c of CAMPOS) if (body[c] !== undefined) row[c] = body[c] === "" ? null : body[c];
    if (!Object.keys(row).length) return jsonErr(400, "Nenhum campo para atualizar");
    row.updated_at = new Date().toISOString();

    const db = supabaseAdmin();
    const { data, error } = await db.from("com_propostas").update(row).eq("id", params.id!).select().single();
    if (error) return jsonErr(400, error.message);
    return jsonOk(data);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
