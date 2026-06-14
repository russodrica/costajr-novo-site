import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../../lib/supabase";
import { addDays, MAX_PARCELAS, MIN_DIAS_PARCELA } from "../../../../../../lib/ferias";

export const prerender = false;

const isData = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !isNaN(new Date(s + "T00:00:00Z").getTime());

// POST /api/admin/rh/ferias/[id]/parcelas
//   { parcelas: [{ data_inicio, dias }] } → substitui as parcelas PROGRAMADAS do período
//   (mantém as já confirmadas). Valida ≤3 no total e soma ≤ dias_direito.
export const POST: APIRoute = async ({ request, params }) => {
  try {
    await requireAdminCookie(request);
    const periodoId = params.id!;
    const body = await request.json();
    const entrada = Array.isArray(body.parcelas) ? body.parcelas : [];
    const db = supabaseAdmin();

    const { data: periodo } = await db.from("rh_ferias_periodos").select("*").eq("id", periodoId).maybeSingle();
    if (!periodo) return jsonErr(404, "Período não encontrado");

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
    if (somaConf + somaNovas > periodo.dias_direito)
      return jsonErr(400, `A soma das parcelas (${somaConf + somaNovas}) excede o direito de ${periodo.dias_direito} dias.`);

    // sobreposição de datas entre as novas parcelas
    const ord = [...novas].sort((a, b) => (a.data_inicio < b.data_inicio ? -1 : 1));
    for (let i = 1; i < ord.length; i++) if (ord[i].data_inicio <= ord[i - 1].data_fim)
      return jsonErr(400, "As parcelas não podem se sobrepor.");

    // substitui as programadas (mantém confirmadas)
    await db.from("rh_ferias_parcelas").delete().eq("periodo_id", periodoId).eq("status", "programada");
    if (novas.length) {
      const { error } = await db.from("rh_ferias_parcelas").insert(novas);
      if (error) return jsonErr(400, error.message);
    }

    const completo = somaConf + somaNovas >= periodo.dias_direito;
    const novoStatus = periodo.status === "vencido" ? "vencido" : completo ? "programado" : "aberto";
    await db.from("rh_ferias_periodos").update({ status: novoStatus, updated_at: new Date().toISOString() }).eq("id", periodoId);

    return jsonOk({ ok: true, programadas: novas.length, soma: somaConf + somaNovas, status: novoStatus });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
