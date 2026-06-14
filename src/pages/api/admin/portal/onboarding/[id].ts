import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { requireAdminCookie, jsonOk, jsonErr } from "~/lib/auth";
import { excluirComLixeira, registrarAcao } from "~/lib/auditoria";

export const prerender = false;

export const PUT: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const id = params.id!;
    const body = await request.json();
    const db = supabaseAdmin();
    const { data, error } = await db.from("portal_onboarding_steps").update(body).eq("id", id).select().single();
    if (error) return jsonErr(500, "Erro ao atualizar.");
    await registrarAcao(db, { req: request, admin }, { acao: "editar", entidade: "portal_onboarding_steps", registro_id: id, descricao: `Editou etapa de onboarding "${data?.titulo ?? id}"`, dados: body });
    return jsonOk(data);
  } catch { return jsonErr(401, "Não autenticado."); }
};

export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const id = params.id!;
    const db = supabaseAdmin();
    const { data: step } = await db.from("portal_onboarding_steps").select("titulo").eq("id", id).maybeSingle();
    const r = await excluirComLixeira(db, { req: request, admin }, {
      tabela: "portal_onboarding_steps", id, idCol: "id", entidade: "portal_onboarding_steps",
      descricao: step ? `Excluiu etapa de onboarding "${step.titulo}"` : `Excluiu etapa de onboarding ${id}`,
    });
    if (!r.ok) return jsonErr(400, r.error || "Falha ao excluir");
    return jsonOk({ ok: true });
  } catch { return jsonErr(401, "Não autenticado."); }
};
