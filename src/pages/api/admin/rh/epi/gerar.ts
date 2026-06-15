import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";
import { EPI_CATALOGO } from "../../../../../lib/epi";
import { bloqueioSeSoLeitura } from "../../../../../lib/permissoes";

export const prerender = false;

// POST /api/admin/rh/epi/gerar
//   { colaborador_id, tipo: "completa" | "reposicao", epis?: string[] }
//   Gera uma ficha (snapshot dos EPIs) para impressão/assinatura. A ficha
//   "completa" leva TODOS os itens ativos; "reposicao" leva só os EPIs pedidos.
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const _ro = await bloqueioSeSoLeitura(admin, "rh"); if (_ro) return _ro;
    const { colaborador_id, tipo = "completa", epis } = await request.json();
    if (!colaborador_id) return jsonErr(400, "Informe colaborador_id.");
    if (!["completa", "reposicao"].includes(tipo)) return jsonErr(400, "Tipo inválido.");
    if (tipo === "reposicao" && (!Array.isArray(epis) || !epis.length)) return jsonErr(400, "Para reposição, informe os EPIs.");

    const db = supabaseAdmin();
    const { data: entregas } = await db.from("epi_entregas").select("*").eq("colaborador_id", colaborador_id).eq("status", "ativo");
    let selecionados = (entregas || []);
    if (tipo === "reposicao") selecionados = selecionados.filter((e: any) => epis.includes(e.epi));
    if (!selecionados.length) return jsonErr(400, "Não há EPIs registrados para gerar a ficha. Registre os itens primeiro.");

    // ordena pela ordem do catálogo
    const ordem = (epi: string) => { const i = EPI_CATALOGO.indexOf(epi); return i < 0 ? 999 : i; };
    selecionados.sort((a: any, b: any) => ordem(a.epi) - ordem(b.epi));
    const itens = selecionados.map((e: any) => ({ epi: e.epi, ca: e.ca, tamanho: e.tamanho, data_entrega: e.data_entrega, data_validade: e.data_validade, data_devolucao: e.data_devolucao }));

    const { data: ficha, error } = await db.from("epi_fichas").insert({
      colaborador_id, tipo, data_geracao: new Date().toISOString().slice(0, 10), itens, status: "gerada", criado_por: admin.email,
    }).select().single();
    if (error) return jsonErr(400, error.message);

    await registrarAcao(db, { req: request, admin }, { acao: "criar", entidade: "epi_fichas", registro_id: ficha.id, descricao: `Gerou ficha de EPI ${tipo} (${itens.length} item(ns))`, dados: { tipo, itens: itens.length } });
    return jsonOk({ ok: true, ficha_id: ficha.id, itens: itens.length });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
