import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";
import { SISTEMAS_CATALOGO, categoriaDoSistema } from "../../../../../lib/sistemas";

export const prerender = false;

const hoje = () => new Date().toISOString().slice(0, 10);

// GET /api/admin/rh/acessos?colaborador_id=...
//   Retorna o catálogo (agrupado) + os acessos salvos do colaborador.
export const GET: APIRoute = async ({ request, url }) => {
  try {
    await requireAdminCookie(request);
    const colaboradorId = url.searchParams.get("colaborador_id");
    if (!colaboradorId) return jsonErr(400, "colaborador_id é obrigatório.");
    const db = supabaseAdmin();
    const { data, error } = await db
      .from("rh_acessos")
      .select("*")
      .eq("colaborador_id", colaboradorId)
      .order("sistema", { ascending: true });
    if (error) return jsonErr(400, error.message);
    return jsonOk({ catalogo: SISTEMAS_CATALOGO, acessos: data || [] });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// POST /api/admin/rh/acessos
//   { colaborador_id, itens: [{ sistema, usuario, observacao, tem_acesso }] }
//   tem_acesso=true  -> grava/atualiza como 'ativo' (define concedido_em se novo).
//   tem_acesso=false -> se já existia ATIVO, marca 'revogado' + revogado_em (mantém histórico);
//                       se nunca teve, ignora (não cria linha).
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const body = await request.json();
    const colaborador_id: string = body?.colaborador_id;
    const itens: any[] = Array.isArray(body?.itens) ? body.itens : [];
    if (!colaborador_id) return jsonErr(400, "colaborador_id é obrigatório.");

    const db = supabaseAdmin();
    const { data: existentes } = await db
      .from("rh_acessos")
      .select("*")
      .eq("colaborador_id", colaborador_id);
    const porSistema: Record<string, any> = {};
    for (const r of existentes || []) porSistema[r.sistema] = r;

    const d = hoje();
    const now = new Date().toISOString();
    const rows: any[] = [];
    let ativos = 0;
    let revogados = 0;

    for (const it of itens) {
      const sistema = String(it?.sistema || "").trim();
      if (!sistema) continue;
      const prev = porSistema[sistema];
      const usuario = (it?.usuario ? String(it.usuario).trim() : "") || null;
      const observacao = (it?.observacao ? String(it.observacao).trim() : "") || null;
      const categoria = categoriaDoSistema(sistema);

      if (it?.tem_acesso) {
        rows.push({
          colaborador_id,
          sistema,
          categoria,
          usuario,
          observacao,
          status: "ativo",
          concedido_em: prev?.concedido_em || d,
          revogado_em: null,
          updated_at: now,
        });
        ativos++;
      } else if (prev && prev.status === "ativo") {
        // revoga (mantém histórico)
        rows.push({
          colaborador_id,
          sistema,
          categoria: prev.categoria || categoria,
          usuario: usuario ?? prev.usuario,
          observacao: observacao ?? prev.observacao,
          status: "revogado",
          concedido_em: prev.concedido_em,
          revogado_em: d,
          updated_at: now,
        });
        revogados++;
      }
      // tem_acesso=false e nunca teve -> ignora
    }

    if (rows.length) {
      const { error } = await db.from("rh_acessos").upsert(rows, { onConflict: "colaborador_id,sistema" });
      if (error) return jsonErr(400, error.message);
    }

    await registrarAcao(db, { req: request, admin }, {
      acao: "editar",
      entidade: "rh_acessos",
      registro_id: colaborador_id,
      descricao: `Atualizou acessos a sistemas do colaborador (${ativos} ativo(s), ${revogados} revogado(s))`,
      dados: { ativos, revogados },
    });

    return jsonOk({ ok: true, ativos, revogados });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
