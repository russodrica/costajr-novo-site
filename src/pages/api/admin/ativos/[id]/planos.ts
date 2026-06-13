import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";

export const prerender = false;

// Planos de manutenção preventiva do ativo (melhoria #10).

export const GET: APIRoute = async ({ request, params }) => {
  try {
    await requireAdminCookie(request);
    const { data, error } = await supabaseAdmin()
      .from("ativos_manutencao_planos")
      .select("*")
      .eq("ativo_id", params.id!)
      .order("proxima_em")
      .limit(200);
    if (error) return jsonErr(500, error.message);
    return jsonOk(data || []);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

export const POST: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const { titulo, periodicidade_dias, proxima_em, observacoes } = await request.json();
    const tituloLimpo = String(titulo || "").trim();
    const dias = Number(periodicidade_dias);
    if (!tituloLimpo || !dias || dias < 1) return jsonErr(400, "Informe o título e a periodicidade (em dias)");
    if (dias > 3650) return jsonErr(400, "Periodicidade muito longa (máx. 3650 dias / 10 anos)");

    const db = supabaseAdmin();
    const { data: ativo } = await db.from("ativos").select("id").eq("id", params.id!).maybeSingle();
    if (!ativo) return jsonErr(404, "Ativo não encontrado");

    let proxima = proxima_em;
    if (proxima) {
      const dt = new Date(proxima);
      if (isNaN(dt.getTime())) return jsonErr(400, "Data da próxima execução inválida");
      proxima = dt.toISOString().slice(0, 10);
    } else {
      const d = new Date(); d.setDate(d.getDate() + dias);
      proxima = d.toISOString().slice(0, 10);
    }
    const { data, error } = await db.from("ativos_manutencao_planos").insert({
      ativo_id: params.id!, titulo: tituloLimpo, periodicidade_dias: dias, proxima_em: proxima,
      observacoes: observacoes || null, criado_por: admin.email,
    }).select().single();
    if (error) return jsonErr(400, error.message);
    return jsonOk(data, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// PATCH body: { id, acao: "executar" | "desativar" }
export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const { id, acao } = await request.json();
    if (!id || !["executar", "desativar"].includes(acao)) return jsonErr(400, "Parâmetros inválidos");
    const db = supabaseAdmin();

    const { data: plano } = await db.from("ativos_manutencao_planos").select("*").eq("id", id).eq("ativo_id", params.id!).maybeSingle();
    if (!plano) return jsonErr(404, "Plano não encontrado");

    if (acao === "desativar") {
      const { data, error } = await db.from("ativos_manutencao_planos").update({ ativo: false }).eq("id", id).select().single();
      if (error) return jsonErr(400, error.message);
      return jsonOk(data);
    }

    // executar: registra a execução de hoje e reprograma a próxima
    const hoje = new Date().toISOString().slice(0, 10);
    const prox = new Date(); prox.setDate(prox.getDate() + plano.periodicidade_dias);
    const { data, error } = await db.from("ativos_manutencao_planos").update({
      ultima_em: hoje,
      proxima_em: prox.toISOString().slice(0, 10),
    }).eq("id", id).select().single();
    if (error) return jsonErr(400, error.message);

    await db.from("ativos_movimentos").insert({
      ativo_id: params.id!,
      tipo: "mudanca_status",
      descricao: `Manutenção preventiva executada: ${plano.titulo} (próxima em ${prox.toLocaleDateString("pt-BR")})`,
      dados: { plano_id: plano.id },
      feito_por: admin.email,
    });

    return jsonOk(data);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
