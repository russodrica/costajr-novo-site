import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";
import { registrarAcao } from "../../../../lib/auditoria";

export const prerender = false;

const CAMPOS = ["nome", "endereco", "cidade", "uf", "responsavel", "observacoes", "ativo"];

// PATCH /api/admin/depositos/[id]  → edita campos / inativa (ativo:false) / reativa
export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const id = params.id!;
    const body = await request.json();
    const db = supabaseAdmin();

    const { data: dep } = await db.from("depositos").select("*").eq("id", id).maybeSingle();
    if (!dep) return jsonErr(404, "Depósito não encontrado.");

    const upd: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const c of CAMPOS) if (body[c] !== undefined) upd[c] = c === "ativo" ? !!body[c] : body[c];
    if (upd.nome !== undefined && !String(upd.nome).trim()) return jsonErr(400, "O nome não pode ficar vazio.");

    const { data, error } = await db.from("depositos").update(upd).eq("id", id).select().single();
    if (error) return jsonErr(400, error.message);

    const acaoTxt = body.ativo === false ? `Inativou o depósito "${dep.nome}"`
      : body.ativo === true ? `Reativou o depósito "${dep.nome}"`
      : `Editou o depósito "${dep.nome}"`;
    await registrarAcao(db, { req: request, admin }, {
      acao: "editar", entidade: "depositos", registro_id: id, descricao: acaoTxt, dados: data,
    });
    return jsonOk(data);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
