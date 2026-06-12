import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { requireAdmin, jsonOk, jsonErr } from "~/lib/auth";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    const claims = await requireAdmin(request);
    if (!["admin", "coordenador", "comercial"].includes(claims.role)) return jsonErr(403, "Sem permissão.");
    const sb = supabaseAdmin();
    const { data } = await sb
      .from("manut_leads")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1000);
    return jsonOk(data || []);
  } catch {
    return jsonErr(401, "Não autenticado.");
  }
};

// POST — cadastrar novo lead (perfis comerciais)
export const POST: APIRoute = async ({ request }) => {
  try {
    const claims = await requireAdmin(request);
    if (!["admin", "coordenador", "comercial"].includes(claims.role)) return jsonErr(403, "Sem permissão.");
    const body = await request.json();
    if (!body.nome || !body.email) return jsonErr(400, "Nome e e-mail são obrigatórios.");
    const campos = ["nome", "nome_loja", "email", "telefone", "plano", "valor", "observacoes", "etapa", "responsavel", "proximo_contato", "origem"];
    const row: Record<string, unknown> = {};
    for (const c of campos) if (body[c] !== undefined && body[c] !== "") row[c] = body[c];
    if (!row.etapa) row.etapa = "novo";
    if (!row.responsavel) row.responsavel = (claims as any).email || null;
    const sb = supabaseAdmin();
    const { data, error } = await sb.from("manut_leads").insert(row).select().single();
    if (error) return jsonErr(400, error.message);
    return jsonOk(data, 201);
  } catch {
    return jsonErr(401, "Não autenticado.");
  }
};

export const PATCH: APIRoute = async ({ request }) => {
  try {
    const claims = await requireAdmin(request);
    if (!["admin", "coordenador", "comercial"].includes(claims.role)) return jsonErr(403, "Sem permissão.");
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (!id) return jsonErr(400, "ID obrigatório.");
    const body = await request.json();
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("manut_leads")
      .update({ ...body, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select().single();
    if (error) return jsonErr(500, "Erro ao atualizar lead.");
    return jsonOk(data);
  } catch {
    return jsonErr(401, "Não autenticado.");
  }
};
