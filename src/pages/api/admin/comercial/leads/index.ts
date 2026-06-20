import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { bloqueioSeSoLeitura } from "../../../../../lib/permissoes";
import { registrarAcao } from "../../../../../lib/auditoria";

export const prerender = false;

const ETAPAS = ["novo", "contato_feito", "proposta_enviada", "negociando", "convertido", "perdido"];

// POST /api/admin/comercial/leads — cria um lead manual no CRM (origem marcada para
// não aparecer nos Pré-cadastros do site).
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const _ro = await bloqueioSeSoLeitura(admin, "comercial"); if (_ro) return _ro;
    const b = await request.json();
    if (!b.nome || !String(b.nome).trim()) return jsonErr(400, "Nome é obrigatório.");
    const db = supabaseAdmin();
    const row: Record<string, any> = {
      nome: String(b.nome).trim(),
      nome_loja: b.nome_loja || null,
      email: b.email || null,
      telefone: b.telefone || null,
      plano: b.plano || null,
      valor: b.valor != null && b.valor !== "" ? Number(String(b.valor).replace(",", ".")) || 0 : null,
      etapa: ETAPAS.includes(b.etapa) ? b.etapa : "novo",
      responsavel: b.responsavel || null,
      observacoes: b.observacoes || null,
      origem: "Cadastro manual (CRM)",
    };
    const { data, error } = await db.from("manut_leads").insert(row).select().single();
    if (error) return jsonErr(500, error.message);
    await registrarAcao(db, { req: request, admin }, { acao: "criar", entidade: "manut_leads", registro_id: data?.id ?? null, descricao: `Criou lead "${row.nome}" no CRM`, dados: row }).catch(() => {});
    return jsonOk(data, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
