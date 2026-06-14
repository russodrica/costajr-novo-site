import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";

export const prerender = false;

// POST /api/admin/rh/desligamentos/finalizar
//   { colaborador_id, data_desligamento, tipo, motivo, entrevista, checklist }
//   checklist = { itens:[{tipo,id,nome,devolvido,estado_ok}], aviso_previo,
//                 exame_emocional, exame_demissional, termo_encerramento, contrato_encerramento }
//   SÓ DESLIGA se TUDO foi devolvido em perfeito estado + passos CLT/PJ cumpridos.
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const body = await request.json();
    const { colaborador_id, checklist = {}, tipo, motivo, entrevista } = body;
    if (!colaborador_id) return jsonErr(400, "colaborador_id é obrigatório.");
    const db = supabaseAdmin();

    const { data: colab } = await db.from("rh_colaboradores").select("id, nome, regime, profile_id").eq("id", colaborador_id).maybeSingle();
    if (!colab) return jsonErr(404, "Colaborador não encontrado");

    // 1) Re-confere a POSSE atual (não confia só no que o cliente mandou)
    const ids = [colab.id, colab.profile_id].filter(Boolean);
    const nomeLow = (colab.nome || "").toLowerCase();
    const { data: ativosAloc } = await db.from("ativos").select("id, descricao, patrimonio, alocado_para_id, alocado_para_nome").eq("alocado_para_tipo", "colaborador").eq("status", "alocado").limit(2000);
    const ativos = (ativosAloc || []).filter((a: any) => (a.alocado_para_id && ids.includes(a.alocado_para_id)) || (a.alocado_para_nome && String(a.alocado_para_nome).toLowerCase() === nomeLow));
    const { data: epis } = await db.from("epi_entregas").select("id, epi, ca").eq("colaborador_id", colaborador_id).eq("status", "ativo");
    const epiPend = (epis || []);

    const marc: Record<string, any> = {};
    for (const it of (checklist.itens || [])) marc[`${it.tipo}:${it.id}`] = it;

    const pendentes: string[] = [];
    for (const a of ativos) { const m = marc[`ativo:${a.id}`]; if (!m || !m.devolvido || !m.estado_ok) pendentes.push(`Ativo: ${a.descricao || a.patrimonio || a.id}`); }
    for (const e of epiPend) { const m = marc[`epi:${e.id}`]; if (!m || !m.devolvido || !m.estado_ok) pendentes.push(`EPI/Uniforme: ${e.epi}`); }

    // 2) Passos por regime
    if (colab.regime === "clt") {
      if (!checklist.exame_demissional) pendentes.push("Exame demissional (ASO)");
      if (!checklist.exame_emocional) pendentes.push("Exame emocional");
      if (!checklist.aviso_previo) pendentes.push("Aviso prévio (cumprido ou dispensado)");
      if (!checklist.termo_encerramento) pendentes.push("Termo de encerramento assinado");
    } else if (colab.regime === "pj") {
      if (!checklist.contrato_encerramento) pendentes.push("Contrato de encerramento (PJ) assinado");
    }

    if (pendentes.length) return jsonErr(400, "Desligamento bloqueado — pendências:\n• " + pendentes.join("\n• "));

    // 3) Tudo OK → devolve EPIs e ativos, conclui desligamento e desliga.
    const hoje = new Date().toISOString().slice(0, 10);
    for (const e of epiPend) await db.from("epi_entregas").update({ status: "devolvido", data_devolucao: hoje }).eq("id", e.id);
    for (const a of ativos) {
      await db.from("ativos").update({ status: "em_estoque", alocado_para_tipo: null, alocado_para_id: null, alocado_para_nome: null }).eq("id", a.id);
      await db.from("ativos_movimentos").insert({ ativo_id: a.id, tipo: "devolucao", descricao: `Devolução no desligamento de ${colab.nome}`, status_anterior: "alocado", status_novo: "em_estoque", feito_por: admin.email });
    }

    const { data: desl, error } = await db.from("rh_desligamentos").insert({
      colaborador_id, data_desligamento: body.data_desligamento || hoje, tipo: tipo || null, motivo: motivo || null,
      entrevista: entrevista || null, checklist, status: "concluido", criado_por: admin.email,
    }).select().single();
    if (error) return jsonErr(400, error.message);

    // desliga o colaborador (o PATCH já revoga o acesso ao portal)
    const patch: any = { status: "desligado", data_desligamento: body.data_desligamento || hoje, updated_at: new Date().toISOString() };
    await db.from("rh_colaboradores").update(patch).eq("id", colaborador_id);
    if (colab.profile_id) {
      await db.from("portal_profiles").update({ approval_status: "rejected" }).eq("id", colab.profile_id);
      await db.from("portal_sessoes").delete().eq("user_id", colab.profile_id);
    }

    await registrarAcao(db, { req: request, admin }, { acao: "editar", entidade: "rh_colaboradores", registro_id: colaborador_id, descricao: `Desligou "${colab.nome}" (devolução conferida, ${ativos.length} ativo(s) + ${epiPend.length} EPI(s))`, dados: { desligamento_id: desl.id } });
    return jsonOk({ ok: true, desligamento_id: desl.id });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
