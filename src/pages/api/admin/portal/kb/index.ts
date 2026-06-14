import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { requireAdminCookie, jsonOk, jsonErr } from "~/lib/auth";
import { registrarAcao } from "~/lib/auditoria";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const claims = await requireAdminCookie(request);
    const { question, answer, category, access_roles } = await request.json();
    if (!question || !answer || !category) return jsonErr(400, "Campos obrigatórios ausentes.");
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("portal_kb")
      .insert({ question, answer, category, access_roles: access_roles?.length ? access_roles : ["all"], created_by: claims.sub })
      .select().single();
    if (error) return jsonErr(500, "Erro ao criar.");
    await registrarAcao(sb, { req: request, admin: claims }, {
      acao: "criar",
      entidade: "portal_kb",
      registro_id: data?.id ?? null,
      descricao: `Criou item da base de conhecimento "${question}" (categoria ${category})`,
      dados: data,
    });
    return jsonOk(data, 201);
  } catch { return jsonErr(401, "Não autenticado."); }
};
