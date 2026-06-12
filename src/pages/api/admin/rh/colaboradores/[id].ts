import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";

export const prerender = false;

// GET /api/admin/rh/colaboradores/[id] — ficha completa (colaborador + ausências + documentos)
export const GET: APIRoute = async ({ request, params }) => {
  try {
    await requireAdminCookie(request);
    const id = params.id!;
    const db = supabaseAdmin();

    const [{ data: colaborador, error }, { data: ausencias }, { data: documentos }] = await Promise.all([
      db.from("rh_colaboradores").select("*").eq("id", id).maybeSingle(),
      db.from("rh_ausencias").select("*").eq("colaborador_id", id).order("data_inicio", { ascending: false }).limit(500),
      db.from("rh_documentos").select("*").eq("colaborador_id", id).order("created_at", { ascending: false }).limit(500),
    ]);
    if (error) return jsonErr(500, error.message);
    if (!colaborador) return jsonErr(404, "Colaborador não encontrado");

    return jsonOk({ colaborador, ausencias: ausencias || [], documentos: documentos || [] });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// PATCH /api/admin/rh/colaboradores/[id] — atualiza dados cadastrais
export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    await requireAdminCookie(request);
    const id = params.id!;
    const body = await request.json();

    const editaveis = [
      "profile_id", "nome", "email", "telefone", "cpf", "rg", "data_nascimento", "foto_url",
      "cargo", "setor", "regime", "salario", "data_admissao", "data_desligamento", "status",
      "endereco", "cidade", "uf", "contato_emergencia_nome", "contato_emergencia_telefone",
      "pix", "banco", "agencia", "conta", "observacoes",
    ];
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const c of editaveis) if (body[c] !== undefined) patch[c] = body[c] === "" ? null : body[c];
    if (Object.keys(patch).length <= 1) return jsonErr(400, "Nada para atualizar");
    if (patch.nome === null) return jsonErr(400, "Nome não pode ficar vazio");

    const db = supabaseAdmin();
    const { data, error } = await db.from("rh_colaboradores").update(patch).eq("id", id).select().single();
    if (error) return jsonErr(400, error.message);
    return jsonOk(data);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
