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
    const { data, error } = await db.from("portal_treinamentos_videos").update(body).eq("id", id).select().single();
    if (error) return jsonErr(500, "Erro ao atualizar.");
    await registrarAcao(db, { req: request, admin }, { acao: "editar", entidade: "portal_treinamentos_videos", registro_id: id, descricao: `Editou vídeo de treinamento "${data.titulo}"`, dados: body });
    return jsonOk(data);
  } catch { return jsonErr(401, "Não autenticado."); }
};

export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const id = params.id!;
    const db = supabaseAdmin();
    const { data: video } = await db.from("portal_treinamentos_videos").select("titulo").eq("id", id).maybeSingle();
    const r = await excluirComLixeira(db, { req: request, admin }, {
      tabela: "portal_treinamentos_videos", id, idCol: "id", entidade: "portal_treinamentos_videos",
      descricao: video ? `Excluiu vídeo de treinamento "${video.titulo}"` : `Excluiu vídeo de treinamento ${id}`,
    });
    if (!r.ok) return jsonErr(400, r.error || "Falha ao excluir");
    return jsonOk({ ok: true });
  } catch { return jsonErr(401, "Não autenticado."); }
};
