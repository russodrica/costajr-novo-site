import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { bloqueioSeSoLeitura } from "../../../../../lib/permissoes";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { excluirComLixeira } from "../../../../../lib/auditoria";

export const prerender = false;

// GET — anotações da obra (mais recentes primeiro)
export const GET: APIRoute = async ({ request, params }) => {
  try {
    await requireAdminCookie(request);
    const db = supabaseAdmin();
    const { data, error } = await db
      .from("obras_anotacoes").select("*")
      .eq("obra_id", params.id!)
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) return jsonErr(500, error.message);
    return jsonOk(data || []);
  } catch (e: any) { return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message); }
};

// POST — nova anotação
export const POST: APIRoute = async ({ request, params }) => {
  try {
    const claims = await requireAdminCookie(request);
    const _ro = await bloqueioSeSoLeitura(claims, "obras"); if (_ro) return _ro;
    const b = await request.json();
    if (!b.texto?.trim()) return jsonErr(400, "Escreva a anotação.");
    const db = supabaseAdmin();
    const { data, error } = await db.from("obras_anotacoes").insert({
      obra_id: params.id!,
      texto: b.texto.trim(),
      criado_por: claims.email || claims.sub,
    }).select().single();
    if (error) return jsonErr(500, error.message);
    return jsonOk(data, 201);
  } catch (e: any) { return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message); }
};

// DELETE ?anotacao=ID — exclui anotação (vai para a lixeira por 30 dias)
export const DELETE: APIRoute = async ({ request, params, url }) => {
  try {
    const admin = await requireAdminCookie(request);
    const _ro = await bloqueioSeSoLeitura(admin, "obras"); if (_ro) return _ro;
    const anotId = url.searchParams.get("anotacao");
    if (!anotId) return jsonErr(400, "Informe ?anotacao=ID.");
    const db = supabaseAdmin();
    // mantém o escopo por obra: só exclui se a anotação pertencer a esta obra
    const { data: anot } = await db
      .from("obras_anotacoes").select("id, texto")
      .eq("id", anotId).eq("obra_id", params.id!).maybeSingle();
    if (!anot) return jsonErr(404, "Anotação não encontrada nesta obra.");
    const resumo = (anot.texto || "").slice(0, 60);
    const r = await excluirComLixeira(db, { req: request, admin }, {
      tabela: "obras_anotacoes", id: anotId, idCol: "id", entidade: "obras_anotacoes",
      descricao: resumo ? `Excluiu anotação "${resumo}"` : `Excluiu anotação ${anotId}`,
    });
    if (!r.ok) return jsonErr(400, r.error || "Falha ao excluir");
    return jsonOk({ ok: true });
  } catch (e: any) { return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message); }
};
