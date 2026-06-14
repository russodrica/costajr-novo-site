import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { requireAdminCookie, jsonOk, jsonErr } from "~/lib/auth";
import { registrarAcao } from "~/lib/auditoria";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const { titulo, conteudo, tipo, ordem, obrigatorio, url_recurso, access_roles } = await request.json();
    if (!titulo || !conteudo) return jsonErr(400, "Campos obrigatórios ausentes.");
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("portal_onboarding_steps")
      .insert({ titulo, conteudo, tipo: tipo || "texto", ordem: ordem || 1, obrigatorio: obrigatorio !== false, url_recurso: url_recurso || null, access_roles: access_roles?.length ? access_roles : ["all"] })
      .select().single();
    if (error) return jsonErr(500, "Erro ao criar etapa.");
    await registrarAcao(sb, { req: request, admin }, { acao: "criar", entidade: "portal_onboarding_steps", registro_id: data?.id ?? null, descricao: `Criou etapa de onboarding "${titulo}"`, dados: data });
    return jsonOk(data, 201);
  } catch { return jsonErr(401, "Não autenticado."); }
};
