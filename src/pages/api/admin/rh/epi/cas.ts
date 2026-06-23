import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";
import { bloqueioSeSoLeitura } from "../../../../../lib/permissoes";

export const prerender = false;

const normCA = (s: any) => String(s || "").replace(/[.\s]/g, "").trim();
const isData = (s: any) => !s || /^\d{4}-\d{2}-\d{2}$/.test(String(s));

// GET /api/admin/rh/epi/cas — consolida os CAs em uso (distintos) com status de vencimento.
export const GET: APIRoute = async ({ request }) => {
  try {
    await requireAdminCookie(request);
    const db = supabaseAdmin();
    const { data, error } = await db.from("epi_entregas")
      .select("ca, epi, colaborador_id, data_validade, status").limit(5000);
    if (error) return jsonErr(500, error.message);

    const hoje = new Date().toISOString().slice(0, 10);
    const em60 = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
    const map = new Map<string, { ca: string; validade: string | null; epis: Set<string>; colabs: Set<string>; entregas: number; ativos: number }>();
    for (const e of data || []) {
      const ca = normCA(e.ca);
      if (!ca || ca.toUpperCase() === "NA") continue;
      if (!map.has(ca)) map.set(ca, { ca, validade: null, epis: new Set(), colabs: new Set(), entregas: 0, ativos: 0 });
      const g = map.get(ca)!;
      g.entregas++;
      if (e.status === "ativo") g.ativos++;
      if (e.epi) g.epis.add(e.epi);
      if (e.colaborador_id) g.colabs.add(e.colaborador_id);
      // validade do CA = a MAIS RECENTE entre as entregas (último vencimento conhecido)
      if (e.data_validade && (!g.validade || e.data_validade > g.validade)) g.validade = e.data_validade;
    }

    const cas = [...map.values()].map((g) => {
      const situacao = !g.validade ? "sem_validade" : g.validade < hoje ? "vencido" : g.validade <= em60 ? "vencendo" : "ok";
      return {
        ca: g.ca, validade: g.validade, situacao,
        epis: [...g.epis], n_epis: g.epis.size, n_colaboradores: g.colabs.size,
        entregas: g.entregas, ativos: g.ativos,
        consulta_url: `https://consultaca.com/${g.ca}`,
      };
    });
    const ordem: Record<string, number> = { vencido: 0, sem_validade: 1, vencendo: 2, ok: 3 };
    cas.sort((a, b) => (ordem[a.situacao] - ordem[b.situacao]) || a.ca.localeCompare(b.ca));
    return jsonOk(cas);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// PATCH /api/admin/rh/epi/cas — atualiza a validade de UM CA em TODAS as entregas que o usam.
//   { ca, data_validade }  (data_validade vazio = limpar)
export const PATCH: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const _ro = await bloqueioSeSoLeitura(admin, "rh"); if (_ro) return _ro;
    const { ca, data_validade } = await request.json();
    const caN = normCA(ca);
    if (!caN) return jsonErr(400, "Informe o CA.");
    if (!isData(data_validade)) return jsonErr(400, "Data de validade inválida (use AAAA-MM-DD).");

    const db = supabaseAdmin();
    // alcança tanto o formato normalizado quanto o com ponto (retrocompat), via OR
    const comPonto = caN.length > 3 ? `${caN.slice(0, -3)}.${caN.slice(-3)}` : caN;
    const { data, error } = await db.from("epi_entregas")
      .update({ data_validade: data_validade || null, aviso_15: false, updated_at: new Date().toISOString() })
      .or(`ca.eq.${caN},ca.eq.${comPonto}`)
      .select("id");
    if (error) return jsonErr(400, error.message);
    await registrarAcao(db, { req: request, admin }, { acao: "editar", entidade: "epi_entregas", registro_id: caN, descricao: `Conferência de CA ${caN}: validade ${data_validade || "(limpa)"} em ${(data || []).length} entrega(s)`, dados: { ca: caN, data_validade } });
    return jsonOk({ ok: true, atualizados: (data || []).length });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
