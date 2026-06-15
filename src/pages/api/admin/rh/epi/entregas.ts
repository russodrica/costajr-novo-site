import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";
import { bloqueioSeSoLeitura } from "../../../../../lib/permissoes";

export const prerender = false;

const isData = (s: any) => !s || /^\d{4}-\d{2}-\d{2}$/.test(String(s));

// POST /api/admin/rh/epi/entregas
//   { colaborador_id, itens: [{ epi, ca, tamanho, data_entrega, data_validade, data_devolucao }] }
//   Registra/atualiza o estado atual dos EPIs do colaborador (upsert por epi).
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const _ro = await bloqueioSeSoLeitura(admin, "rh"); if (_ro) return _ro;
    const body = await request.json();
    const { colaborador_id, itens } = body;
    if (!colaborador_id || !Array.isArray(itens)) return jsonErr(400, "Informe colaborador_id e itens.");

    const rows: any[] = [];
    for (const it of itens) {
      if (!it.epi) continue;
      if (!isData(it.data_entrega) || !isData(it.data_validade) || !isData(it.data_devolucao)) return jsonErr(400, `Data inválida no item "${it.epi}".`);
      rows.push({
        colaborador_id, epi: String(it.epi),
        ca: it.ca || null, tamanho: it.tamanho || null,
        data_entrega: it.data_entrega || null, data_validade: it.data_validade || null,
        data_devolucao: it.data_devolucao || null,
        status: it.data_devolucao ? "devolvido" : "ativo",
        aviso_15: false, // ao mexer no item, libera novo alerta de vencimento
        updated_at: new Date().toISOString(),
      });
    }
    if (!rows.length) return jsonErr(400, "Nenhum item válido.");

    const db = supabaseAdmin();
    const { error } = await db.from("epi_entregas").upsert(rows, { onConflict: "colaborador_id,epi" });
    if (error) return jsonErr(400, error.message);
    await registrarAcao(db, { req: request, admin }, { acao: "editar", entidade: "epi_entregas", registro_id: colaborador_id, descricao: `Atualizou EPIs do colaborador (${rows.length} item(ns))`, dados: { itens: rows.map((r) => ({ epi: r.epi, ca: r.ca, validade: r.data_validade })) } });
    return jsonOk({ ok: true, salvos: rows.length });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
