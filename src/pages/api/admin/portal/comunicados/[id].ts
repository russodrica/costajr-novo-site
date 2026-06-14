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
    const sb = supabaseAdmin();
    const { data, error } = await sb.from("portal_announcements").update(body).eq("id", id).select().single();
    if (error) return jsonErr(500, "Erro ao atualizar.");
    await registrarAcao(sb, { req: request, admin }, { acao: "editar", entidade: "portal_announcements", registro_id: id, descricao: `Editou comunicado "${data?.title ?? id}"`, dados: body });
    return jsonOk(data);
  } catch { return jsonErr(401, "Não autenticado."); }
};

export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const id = params.id!;
    const sb = supabaseAdmin();
    const { data: com } = await sb.from("portal_announcements").select("title").eq("id", id).maybeSingle();
    const r = await excluirComLixeira(sb, { req: request, admin }, {
      tabela: "portal_announcements", id, idCol: "id", entidade: "portal_announcements",
      descricao: com ? `Excluiu comunicado "${com.title}"` : `Excluiu comunicado ${id}`,
    });
    if (!r.ok) return jsonErr(400, r.error || "Falha ao excluir");
    return jsonOk({ ok: true });
  } catch { return jsonErr(401, "Não autenticado."); }
};
