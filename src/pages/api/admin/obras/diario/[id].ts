import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";
import { bloqueioSeSoLeitura } from "../../../../../lib/permissoes";
import {
  climaValido, condicaoValida, statusValido, situacaoValida,
  limparEfetivo, limparEquipamentos, limparOcorrencias,
} from "../../../../../lib/rdo";

export const prerender = false;
const MODULO = "obras";

// PATCH /api/admin/obras/diario/[id]
// Salva o relatório inteiro de uma vez (campos + checklist). A tela manda tudo
// junto: é um formulário só, e salvar por partes deixaria o relatório meio
// gravado se a conexão caísse no meio.
export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const bl = await bloqueioSeSoLeitura(admin, MODULO); if (bl) return bl;
    const db = supabaseAdmin();
    const id = params.id!;

    const { data: atual } = await db.from("obras_rdo").select("id, data, obra_id, status").eq("id", id).maybeSingle();
    if (!atual) return jsonErr(404, "Relatório não encontrado.");

    const b = await request.json().catch(() => null);
    if (!b) return jsonErr(400, "Envie os dados do relatório.");

    const patch: Record<string, unknown> = {
      clima_manha: climaValido(b.clima_manha),
      clima_tarde: climaValido(b.clima_tarde),
      condicao: condicaoValida(b.condicao),
      responsavel: String(b.responsavel ?? "").trim() || null,
      inicio_jornada: String(b.inicio_jornada ?? "").trim() || null,
      fim_jornada: String(b.fim_jornada ?? "").trim() || null,
      atividades: String(b.atividades ?? "").trim() || null,
      observacoes: String(b.observacoes ?? "").trim() || null,
      efetivo_itens: limparEfetivo(b.efetivo_itens),
      equipamentos_itens: limparEquipamentos(b.equipamentos_itens),
      ocorrencias_itens: limparOcorrencias(b.ocorrencias_itens),
      updated_at: new Date().toISOString(),
    };

    // `efetivo` (número) é da versão antiga da tabela e continua alimentando a
    // tela antiga da obra — mantemos em dia a partir da soma das funções.
    patch.efetivo = (patch.efetivo_itens as any[]).reduce((s, i) => s + (i.qtd || 0), 0) || null;

    const status = statusValido(b.status);
    if (status) {
      patch.status = status;
      if (status === "publicado" && atual.status !== "publicado") {
        // publicar exige o mínimo: relatório vazio não vai para o cliente
        if (!patch.atividades) return jsonErr(400, "Descreva as atividades antes de publicar o relatório.");
        patch.publicado_em = new Date().toISOString();
      }
      if (status === "rascunho") patch.publicado_em = null;
    }

    const { error } = await db.from("obras_rdo").update(patch).eq("id", id);
    if (error) {
      console.error("[rdo] update falhou:", error.code, error.message, error.details);
      return jsonErr(400, "Não deu para salvar agora.");
    }

    // checklist: a tela manda a lista inteira, então troca por completo
    if (Array.isArray(b.checklist)) {
      await db.from("obras_rdo_checklist").delete().eq("rdo_id", id);
      const linhas = b.checklist
        .map((c: any, i: number) => ({
          rdo_id: id,
          item: String(c?.item ?? "").trim().slice(0, 300),
          situacao: situacaoValida(c?.situacao),
          observacao: String(c?.observacao ?? "").trim() || null,
          ordem: i,
        }))
        .filter((c: any) => c.item)
        .slice(0, 100);
      if (linhas.length) await db.from("obras_rdo_checklist").insert(linhas);
    }

    await registrarAcao(db, { req: request, admin }, {
      acao: "editar", entidade: "obras_rdo", registro_id: id,
      descricao: `RDO ${atual.data}${status === "publicado" ? " (publicado)" : ""}`,
    });
    return jsonOk({ ok: true, status: patch.status ?? atual.status });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// DELETE /api/admin/obras/diario/[id] — só rascunho.
// Relatório publicado é registro do que aconteceu na obra: some da tela pela
// obra, não some do banco.
export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const bl = await bloqueioSeSoLeitura(admin, MODULO); if (bl) return bl;
    const db = supabaseAdmin();
    const id = params.id!;

    const { data: atual } = await db.from("obras_rdo").select("id, data, status").eq("id", id).maybeSingle();
    if (!atual) return jsonErr(404, "Relatório não encontrado.");
    if (atual.status === "publicado") {
      return jsonErr(400, "Relatório publicado não pode ser apagado. Volte para rascunho se precisar corrigir.");
    }

    const { error } = await db.from("obras_rdo").delete().eq("id", id);
    if (error) return jsonErr(400, error.message);

    await registrarAcao(db, { req: request, admin }, {
      acao: "excluir", entidade: "obras_rdo", registro_id: id,
      descricao: `RDO ${atual.data} (rascunho)`,
    });
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
