import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../../lib/supabase";
import { addDays, fmtBR, MAX_PARCELAS, MIN_DIAS_PARCELA } from "../../../../../../lib/ferias";
import { registrarAcao } from "../../../../../../lib/auditoria";
import { bloqueioSeSoLeitura } from "../../../../../../lib/permissoes";

export const prerender = false;

const isData = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !isNaN(new Date(s + "T00:00:00Z").getTime());

// POST /api/admin/rh/ferias/[id]/parcelas
//   { parcelas: [{ data_inicio, dias }] } → substitui as parcelas PROGRAMADAS do período
//   (mantém as já confirmadas). Valida ≤3 no total e soma ≤ dias_direito.
export const POST: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const _ro = await bloqueioSeSoLeitura(admin, "rh"); if (_ro) return _ro;
    const periodoId = params.id!;
    const body = await request.json();
    const entrada = Array.isArray(body.parcelas) ? body.parcelas : [];
    const db = supabaseAdmin();

    const { data: periodo } = await db.from("rh_ferias_periodos").select("*").eq("id", periodoId).maybeSingle();
    if (!periodo) return jsonErr(404, "Período não encontrado");

    // Abono pecuniário (vender dias): 0/10/15/20/30. Reduz o descanso a programar.
    const ABONOS = [0, 10, 15, 20, 30];
    const abono = body.dias_abono === undefined ? (periodo.dias_abono || 0) : parseInt(body.dias_abono, 10) || 0;
    if (!ABONOS.includes(abono)) return jsonErr(400, "Abono inválido — use 0, 10, 15, 20 ou 30 dias.");
    if (abono >= periodo.dias_direito) return jsonErr(400, `O abono não pode ser igual ou maior que o direito (${periodo.dias_direito} dias).`);

    const { data: existentes } = await db.from("rh_ferias_parcelas").select("*").eq("periodo_id", periodoId);
    const confirmadas = (existentes || []).filter((p: any) => p.status === "confirmada");

    // normaliza + valida entrada
    const novas: any[] = [];
    for (const p of entrada) {
      const dias = parseInt(p.dias, 10);
      if (!isData(p.data_inicio)) return jsonErr(400, `Data de início inválida: "${p.data_inicio}"`);
      if (isNaN(dias) || dias < MIN_DIAS_PARCELA) return jsonErr(400, `Cada parcela precisa ter no mínimo ${MIN_DIAS_PARCELA} dias.`);
      novas.push({
        periodo_id: periodoId, colaborador_id: periodo.colaborador_id,
        data_inicio: p.data_inicio, dias, data_fim: addDays(p.data_inicio, dias - 1), status: "programada",
      });
    }

    if (confirmadas.length + novas.length > MAX_PARCELAS)
      return jsonErr(400, `Máximo de ${MAX_PARCELAS} parcelas por período (já há ${confirmadas.length} confirmada(s)).`);
    const somaConf = confirmadas.reduce((s: number, p: any) => s + p.dias, 0);
    const somaNovas = novas.reduce((s, p) => s + p.dias, 0);
    if (somaConf + somaNovas + abono > periodo.dias_direito)
      return jsonErr(400, `A soma das parcelas (${somaConf + somaNovas}) + abono vendido (${abono}) excede o direito de ${periodo.dias_direito} dias.`);

    // sobreposição de datas entre as novas parcelas
    const ord = [...novas].sort((a, b) => (a.data_inicio < b.data_inicio ? -1 : 1));
    for (let i = 1; i < ord.length; i++) if (ord[i].data_inicio <= ord[i - 1].data_fim)
      return jsonErr(400, "As parcelas não podem se sobrepor.");

    // NÃO permite dois colaboradores de férias ao mesmo tempo: checa sobreposição
    // com as parcelas (programadas/confirmadas) de QUALQUER OUTRO colaborador.
    if (novas.length) {
      const { data: outras } = await db.from("rh_ferias_parcelas")
        .select("data_inicio, data_fim, colaborador_id, rh_colaboradores(nome)")
        .neq("colaborador_id", periodo.colaborador_id).limit(5000);
      for (const nova of novas) {
        const conflito = (outras || []).find((o: any) => nova.data_inicio <= o.data_fim && nova.data_fim >= o.data_inicio);
        if (conflito) {
          const c: any = conflito.rh_colaboradores;
          const quem = (Array.isArray(c) ? c[0]?.nome : c?.nome) || "outro colaborador";
          return jsonErr(400, `O período desejado (${fmtBR(nova.data_inicio)} a ${fmtBR(nova.data_fim)}) NÃO é permitido: coincide com as férias de ${quem} (${fmtBR(conflito.data_inicio)} a ${fmtBR(conflito.data_fim)}). Não é permitido dois colaboradores de férias ao mesmo tempo — escolha outras datas.`);
        }
      }
    }

    // substitui as programadas (mantém confirmadas)
    await db.from("rh_ferias_parcelas").delete().eq("periodo_id", periodoId).eq("status", "programada");
    if (novas.length) {
      const { error } = await db.from("rh_ferias_parcelas").insert(novas);
      if (error) return jsonErr(400, error.message);
      await registrarAcao(db, { req: request, admin }, {
        acao: "criar",
        entidade: "rh_ferias_parcelas",
        registro_id: periodoId,
        descricao: `Programou ${novas.length} parcela(s) de férias (${somaNovas} dias) do período ${periodoId}`,
        dados: { periodo_id: periodoId, parcelas: novas },
      });
    }

    const completo = somaConf + somaNovas + abono >= periodo.dias_direito;
    const novoStatus = periodo.status === "vencido" ? "vencido" : completo ? "programado" : "aberto";
    await db.from("rh_ferias_periodos").update({ status: novoStatus, dias_abono: abono, updated_at: new Date().toISOString() }).eq("id", periodoId);

    return jsonOk({ ok: true, programadas: novas.length, abono, soma: somaConf + somaNovas, status: novoStatus });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
