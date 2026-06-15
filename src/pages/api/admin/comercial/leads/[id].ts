import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { bloqueioSeSoLeitura } from "../../../../../lib/permissoes";

export const prerender = false;

const ETAPAS = ["novo", "contato_feito", "proposta_enviada", "negociando", "convertido", "perdido"];
// Todos os campos editáveis pelo CRM (inclui colunas novas da migration 023)
const CAMPOS = ["etapa", "kanban_ordem", "responsavel", "proximo_contato", "valor", "plano", "observacoes"];
// Campos que existem desde a migration 002 (fallback se a 023 ainda não rodou em produção)
const CAMPOS_BASE = ["etapa", "observacoes", "valor", "plano"];

const AVISO_MIGRATION =
  "Alguns campos foram ignorados porque as colunas novas ainda não existem no banco — rode db/migrations/023_comercial.sql no Supabase.";

function colunaInexistente(error: { code?: string; message?: string }): boolean {
  const msg = (error.message || "").toLowerCase();
  return (
    error.code === "PGRST204" ||
    error.code === "42703" ||
    (msg.includes("column") && (msg.includes("does not exist") || msg.includes("could not find")))
  );
}

// PATCH /api/admin/comercial/leads/:id — atualiza campos do lead no funil
export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const _ro = await bloqueioSeSoLeitura(admin, "comercial"); if (_ro) return _ro;
    const body = await request.json();

    if (body.etapa !== undefined && !ETAPAS.includes(body.etapa)) {
      return jsonErr(400, "Etapa inválida");
    }

    const row: Record<string, unknown> = {};
    for (const c of CAMPOS) if (body[c] !== undefined) row[c] = body[c] === "" ? null : body[c];
    if (!Object.keys(row).length) return jsonErr(400, "Nenhum campo para atualizar");
    row.updated_at = new Date().toISOString();

    const db = supabaseAdmin();
    const { data, error } = await db.from("manut_leads").update(row).eq("id", params.id!).select().single();

    if (error && colunaInexistente(error)) {
      // Banco em produção pode não ter as colunas da migration 023 — tenta só os campos base
      const base: Record<string, unknown> = { updated_at: row.updated_at };
      for (const c of CAMPOS_BASE) if (row[c] !== undefined) base[c] = row[c];
      if (Object.keys(base).length <= 1) {
        // Só pediram campos novos: nada a salvar, mas não quebra a tela
        return jsonOk({ ok: true, aviso: AVISO_MIGRATION });
      }
      const retry = await db.from("manut_leads").update(base).eq("id", params.id!).select().single();
      if (retry.error) return jsonErr(400, retry.error.message);
      return jsonOk({ ...retry.data, aviso: AVISO_MIGRATION });
    }

    if (error) return jsonErr(400, error.message);
    return jsonOk(data);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
