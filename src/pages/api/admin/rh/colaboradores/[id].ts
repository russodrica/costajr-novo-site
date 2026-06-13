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

    // membro vinculado (acesso ao portal), se houver
    let membro: any = null;
    if (colaborador.profile_id) {
      const { data: m } = await db.from("portal_profiles")
        .select("id, email, role, roles, approval_status").eq("id", colaborador.profile_id).maybeSingle();
      if (m) membro = m;
    }

    return jsonOk({ colaborador, ausencias: ausencias || [], documentos: documentos || [], membro });
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

    if (body.regime !== undefined && body.regime && !["clt", "pj", "estagio", "temporario", "socio", "diarista"].includes(body.regime)) return jsonErr(400, "Regime inválido");
    if (body.status !== undefined && !["ativo", "ferias", "afastado", "desligado"].includes(body.status)) return jsonErr(400, "Status inválido");

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

    // Ao desligar, registra a data de desligamento automaticamente (se não informada)
    if (patch.status === "desligado" && !body.data_desligamento) {
      patch.data_desligamento = new Date().toISOString().slice(0, 10);
    }

    const db = supabaseAdmin();
    const { data, error } = await db.from("rh_colaboradores").update(patch).eq("id", id).select().single();
    if (error) return jsonErr(400, error.message);
    return jsonOk(data);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
