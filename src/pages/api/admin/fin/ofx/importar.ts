import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { parseOfx } from "../../../../../lib/ofx";
import { registrarAcao } from "../../../../../lib/auditoria";
import { bloqueioSeSoLeitura } from "../../../../../lib/permissoes";

export const prerender = false;

// POST /api/admin/fin/ofx/importar — body { conteudo: string (texto do arquivo OFX) }
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const _ro = await bloqueioSeSoLeitura(admin, "financeiro"); if (_ro) return _ro;
    const body = await request.json();
    const conteudo = body?.conteudo;
    if (!conteudo || typeof conteudo !== "string")
      return jsonErr(400, "Conteúdo do arquivo OFX é obrigatório");

    const { conta, transacoes } = parseOfx(conteudo);
    if (!transacoes.length)
      return jsonErr(400, "Nenhuma transação encontrada no arquivo. Confira se é um arquivo OFX válido.");

    // dedup dentro do próprio arquivo (alguns bancos repetem FITID)
    const porFitid = new Map<string, (typeof transacoes)[number]>();
    for (const t of transacoes) if (!porFitid.has(t.fitid)) porFitid.set(t.fitid, t);
    const unicas = Array.from(porFitid.values());

    const db = supabaseAdmin();

    // descobre quais FITIDs já existem (em lotes de 500)
    const fitids = unicas.map(t => t.fitid);
    const existentes = new Set<string>();
    for (let i = 0; i < fitids.length; i += 500) {
      const lote = fitids.slice(i, i + 500);
      const { data, error } = await db.from("fin_extrato_ofx").select("fitid").in("fitid", lote);
      if (error) return jsonErr(500, error.message);
      for (const r of data || []) existentes.add(r.fitid);
    }

    const novas = unicas
      .filter(t => !existentes.has(t.fitid))
      .map(t => ({
        fitid: t.fitid,
        conta: conta || null,
        data: t.data,
        valor: t.valor,
        descricao: t.descricao,
        status: "pendente",
      }));

    if (novas.length) {
      for (let i = 0; i < novas.length; i += 500) {
        const { error } = await db.from("fin_extrato_ofx").insert(novas.slice(i, i + 500));
        if (error) return jsonErr(500, error.message);
      }
    }

    const duplicadas = unicas.length - novas.length + (transacoes.length - unicas.length);
    await registrarAcao(db, { req: request, admin }, {
      acao: "criar",
      entidade: "fin_extrato_ofx",
      registro_id: null,
      descricao: `Importou ${novas.length} transação(ões) OFX${conta ? ` da conta ${conta}` : ""}`,
      dados: { criados: novas.length, duplicadas, conta: conta || null },
    });

    return jsonOk({
      importadas: novas.length,
      duplicadas: unicas.length - novas.length + (transacoes.length - unicas.length),
      conta,
    });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
