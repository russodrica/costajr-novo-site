import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { requireAdminCookie, jsonOk, jsonErr } from "~/lib/auth";
import { registrarAcao } from "~/lib/auditoria";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const claims = await requireAdminCookie(request);
    const { titulo, url_video, categoria, descricao, ordem, duracao_minutos, publicado, access_roles } = await request.json();
    if (!titulo || !url_video) return jsonErr(400, "Título e URL são obrigatórios.");
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("portal_treinamentos_videos")
      .insert({ titulo, url_video, categoria: categoria || "geral", descricao, ordem: ordem || 1, duracao_minutos: duracao_minutos || null, publicado: publicado !== false, access_roles: access_roles?.length ? access_roles : ["all"], created_by: claims.sub })
      .select().single();
    if (error) return jsonErr(500, "Erro ao criar.");
    await registrarAcao(sb, { req: request, admin: { email: claims.email, role: claims.role } }, {
      acao: "criar",
      entidade: "portal_treinamentos_videos",
      registro_id: data?.id ?? null,
      descricao: `Criou treinamento "${titulo}"`,
      dados: data,
    });
    return jsonOk(data, 201);
  } catch { return jsonErr(401, "Não autenticado."); }
};
