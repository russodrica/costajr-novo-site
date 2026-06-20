import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { requireAdmin, jsonOk, jsonErr } from "~/lib/auth";
import { filtroAcessoConteudo } from "~/lib/permissoes";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    const claims = await requireAdmin(request);
    const sb = supabaseAdmin();
    let q = sb.from("portal_treinamentos_pdfs").select("*").eq("publicado", true);
    const filtro = await filtroAcessoConteudo(claims); // null = admin vê tudo
    if (filtro) q = q.or(filtro);
    const { data } = await q.order("categoria").order("ordem");
    // NÃO assina aqui: a abertura passa pelo player com marca d'água (→ /treino).
    return jsonOk(data || []);
  } catch {
    return jsonErr(401, "Não autenticado.");
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const claims = await requireAdmin(request);
    if (!["admin", "rh"].includes(claims.role)) return jsonErr(403, "Sem permissão.");
    const body = await request.json();
    const { titulo, descricao, url, storage_path, categoria, access_roles, paginas, ordem } = body;
    if (!titulo || (!url && !storage_path)) return jsonErr(400, "Campos obrigatórios ausentes.");
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("portal_treinamentos_pdfs")
      .insert({ titulo, descricao, url, storage_path, categoria: categoria || "geral", access_roles: access_roles || ["{all}"], paginas, ordem: ordem || 0, created_by: claims.sub })
      .select().single();
    if (error) return jsonErr(500, "Erro ao criar PDF.");
    return jsonOk(data, 201);
  } catch {
    return jsonErr(401, "Não autenticado.");
  }
};
