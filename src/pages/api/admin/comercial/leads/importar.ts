import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { bloqueioSeSoLeitura } from "../../../../../lib/permissoes";
import { registrarAcao } from "../../../../../lib/auditoria";

export const prerender = false;

const ETAPAS = ["novo", "contato_feito", "proposta_enviada", "negociando", "convertido", "perdido"];

// POST /api/admin/comercial/leads/importar { itens: [{nome, nome_loja, email, telefone, plano, valor, etapa, responsavel}] }
// Importa leads em massa (origem marcada para não poluir os Pré-cadastros do site).
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const _ro = await bloqueioSeSoLeitura(admin, "comercial"); if (_ro) return _ro;
    const { itens } = await request.json();
    if (!Array.isArray(itens) || !itens.length) return jsonErr(400, "Nenhuma linha para importar.");
    const rows = itens.map((it: any) => ({
      nome: String(it.nome || "").trim(),
      nome_loja: it.nome_loja || null,
      email: it.email || null,
      telefone: it.telefone || null,
      plano: it.plano || null,
      valor: it.valor != null && String(it.valor).trim() !== "" ? Number(String(it.valor).replace(/\./g, "").replace(",", ".")) || 0 : null,
      etapa: ETAPAS.includes(it.etapa) ? it.etapa : "novo",
      responsavel: it.responsavel || null,
      origem: "Importação (CRM)",
    })).filter((r) => r.nome);
    if (!rows.length) return jsonErr(400, "Nenhuma linha com Nome preenchido.");
    if (rows.length > 5000) return jsonErr(400, "Máximo de 5000 linhas por importação.");
    const db = supabaseAdmin();
    const { error } = await db.from("manut_leads").insert(rows);
    if (error) return jsonErr(500, error.message);
    await registrarAcao(db, { req: request, admin }, { acao: "criar", entidade: "manut_leads", registro_id: null, descricao: `Importou ${rows.length} lead(s) no CRM`, dados: { inseridos: rows.length } }).catch(() => {});
    return jsonOk({ ok: true, inseridos: rows.length });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
