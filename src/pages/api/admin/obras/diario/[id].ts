import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";
import { bloqueioSeSoLeitura } from "../../../../../lib/permissoes";
import {
  climaValido, condicaoValida, statusValido, situacaoValida,
  empresaValida, limparOcorrencias,
} from "../../../../../lib/rdo";

export const prerender = false;
const MODULO = "obras";

// PATCH /api/admin/obras/diario/[id]
// Salva o Relatório de Visita inteiro de uma vez (campos + checklist). A tela manda tudo
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

    // Mão de obra e equipamentos saíram do Relatório de Visita: a visita
    // registra o que foi visto, não a folha de efetivo do dia. As colunas
    // continuam no banco pelo histórico já gravado, mas não são mais tocadas.
    const patch: Record<string, unknown> = {
      empresa: empresaValida(b.empresa),
      clima_manha: climaValido(b.clima_manha),
      clima_tarde: climaValido(b.clima_tarde),
      condicao: condicaoValida(b.condicao),
      responsavel: String(b.responsavel ?? "").trim() || null,
      inicio_jornada: String(b.inicio_jornada ?? "").trim() || null,
      fim_jornada: String(b.fim_jornada ?? "").trim() || null,
      atividades: String(b.atividades ?? "").trim() || null,
      observacoes: String(b.observacoes ?? "").trim() || null,
      ocorrencias_itens: limparOcorrencias(b.ocorrencias_itens),
      updated_at: new Date().toISOString(),
    };

    // Assinaturas: PNG em data URL, traçado na tela. O teto de 400 KB evita que
    // alguém mande uma foto disfarçada de assinatura e inche o registro.
    const assinatura = (v: unknown) => {
      const s = String(v ?? "");
      if (!s) return null;
      if (!s.startsWith("data:image/png;base64,") || s.length > 400_000) return null;
      return s;
    };
    if (b.assinatura_visita !== undefined) patch.assinatura_visita = assinatura(b.assinatura_visita);
    if (b.assinatura_cliente !== undefined) patch.assinatura_cliente = assinatura(b.assinatura_cliente);
    if (b.assinatura_visita_nome !== undefined)
      patch.assinatura_visita_nome = String(b.assinatura_visita_nome ?? "").trim().slice(0, 200) || null;
    if (b.assinatura_cliente_nome !== undefined)
      patch.assinatura_cliente_nome = String(b.assinatura_cliente_nome ?? "").trim().slice(0, 200) || null;
    if (patch.assinatura_visita || patch.assinatura_cliente) patch.assinado_em = new Date().toISOString();

    const status = statusValido(b.status);
    if (status) {
      patch.status = status;
      if (status === "publicado" && atual.status !== "publicado") {
        // publicar exige o mínimo: relatório vazio não vai para o cliente
        if (!patch.atividades) return jsonErr(400, "Descreva o que foi verificado na visita antes de publicar o relatório.");
        patch.publicado_em = new Date().toISOString();
      }
      if (status === "rascunho") patch.publicado_em = null;
    }

    const { error } = await db.from("obras_rdo").update(patch).eq("id", id);
    if (error) {
      console.error("[rdo] update falhou:", error.code, error.message, error.details);
      return jsonErr(400, "Não deu para salvar agora.");
    }

    // Nome novo de responsável entra no catálogo sozinho: quem está em campo
    // digita uma vez e nas próximas visitas o nome já aparece na lista.
    const resp = patch.responsavel as string | null;
    if (resp) {
      await db.from("obras_cat_responsaveis")
        .upsert({ nome: resp }, { onConflict: "nome", ignoreDuplicates: true });
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
      descricao: `Relatório de visita ${atual.data}${status === "publicado" ? " (publicado)" : ""}`,
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
      descricao: `Relatório de visita ${atual.data} (rascunho)`,
    });
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
