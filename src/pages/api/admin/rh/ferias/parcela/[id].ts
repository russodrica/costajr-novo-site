import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../../lib/supabase";
import { addMonths, addDays } from "../../../../../../lib/ferias";
import { excluirComLixeira, registrarAcao } from "../../../../../../lib/auditoria";
import { bloqueioSeSoLeitura } from "../../../../../../lib/permissoes";

export const prerender = false;

// POST /api/admin/rh/ferias/parcela/[id] — confirma ("dar OK") que a parcela foi gozada.
//   Quando a soma das confirmadas atinge o direito, o período conclui e o próximo é liberado.
export const POST: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const _ro = await bloqueioSeSoLeitura(admin, "rh"); if (_ro) return _ro;
    const parcelaId = params.id!;
    const db = supabaseAdmin();

    const { data: parcela } = await db.from("rh_ferias_parcelas").select("*").eq("id", parcelaId).maybeSingle();
    if (!parcela) return jsonErr(404, "Parcela não encontrada");
    if (parcela.status === "confirmada") return jsonOk({ ok: true, ja_confirmada: true });

    await db.from("rh_ferias_parcelas").update({ status: "confirmada", confirmada_em: new Date().toISOString(), confirmada_por: admin.email }).eq("id", parcelaId);
    await registrarAcao(db, { req: request, admin }, { acao: "editar", entidade: "rh_ferias_parcelas", registro_id: parcelaId, descricao: `Confirmou gozo de parcela de férias ${parcelaId} (${parcela.dias} dias)`, dados: { status: "confirmada" } });

    const { data: periodo } = await db.from("rh_ferias_periodos").select("*").eq("id", parcela.periodo_id).maybeSingle();
    const { data: irmas } = await db.from("rh_ferias_parcelas").select("dias, status").eq("periodo_id", parcela.periodo_id);
    const somaConf = (irmas || []).filter((p: any) => p.status === "confirmada").reduce((s: number, p: any) => s + p.dias, 0);

    let concluido = false, proximo = null;
    if (periodo && somaConf >= periodo.dias_direito) {
      // período concluído → histórico
      await db.from("rh_ferias_periodos").update({ status: "concluido", updated_at: new Date().toISOString() }).eq("id", periodo.id);
      concluido = true;
      // libera o próximo período aquisitivo (se ainda não existir)
      const inicio = addMonths(periodo.inicio_aquisitivo, 12);
      const fim = addDays(addMonths(inicio, 12), -1);
      const limite = addMonths(fim, 12);
      const { data: jaExiste } = await db.from("rh_ferias_periodos").select("id").eq("colaborador_id", periodo.colaborador_id).eq("inicio_aquisitivo", inicio).maybeSingle();
      if (!jaExiste) {
        const { data } = await db.from("rh_ferias_periodos").insert({
          colaborador_id: periodo.colaborador_id, inicio_aquisitivo: inicio, fim_aquisitivo: fim,
          limite_concessivo: limite, dias_direito: 30, status: "aberto",
        }).select().single();
        proximo = data;
      }
    }
    return jsonOk({ ok: true, concluido, proximo, soma_confirmada: somaConf });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// DELETE /api/admin/rh/ferias/parcela/[id] — remove uma parcela ainda não confirmada.
export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const _ro = await bloqueioSeSoLeitura(admin, "rh"); if (_ro) return _ro;
    const parcelaId = params.id!;
    const db = supabaseAdmin();
    const { data: parcela } = await db.from("rh_ferias_parcelas").select("*").eq("id", parcelaId).maybeSingle();
    if (!parcela) return jsonErr(404, "Parcela não encontrada");
    if (parcela.status === "confirmada") return jsonErr(400, "Não é possível remover uma parcela já confirmada.");

    const r = await excluirComLixeira(db, { req: request, admin }, {
      tabela: "rh_ferias_parcelas", id: parcelaId, idCol: "id", entidade: "rh_ferias_parcelas",
      descricao: `Excluiu parcela de férias ${parcelaId} (${parcela.dias} dias)`,
    });
    if (!r.ok) return jsonErr(400, r.error || "Falha ao excluir");

    // recalcula status do período
    const { data: periodo } = await db.from("rh_ferias_periodos").select("*").eq("id", parcela.periodo_id).maybeSingle();
    if (periodo && periodo.status !== "concluido" && periodo.status !== "vencido") {
      const { data: restantes } = await db.from("rh_ferias_parcelas").select("dias").eq("periodo_id", periodo.id);
      const soma = (restantes || []).reduce((s: number, p: any) => s + p.dias, 0);
      await db.from("rh_ferias_periodos").update({ status: soma >= periodo.dias_direito ? "programado" : "aberto", updated_at: new Date().toISOString() }).eq("id", periodo.id);
    }
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
