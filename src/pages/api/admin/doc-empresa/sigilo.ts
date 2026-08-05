import type { APIRoute } from "astro";
import { requireAdminCookie, temPerfil, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";
import { registrarAcao } from "../../../../lib/auditoria";
import { bloqueioSeSemLeitura } from "../../../../lib/permissoes";

export const prerender = false;
const PERFIS = ["admin", "financeiro", "juridico"];

// Tabela + rótulo de cada tipo de documento que aceita o cadeado 🔒.
const TABELAS: Record<string, { tabela: string; rotulo: string }> = {
  extrato: { tabela: "doc_extratos_bancarios", rotulo: "extrato" },
  fatura: { tabela: "doc_cartao_faturas", rotulo: "fatura de cartão" },
  emprestimo: { tabela: "doc_emprestimos", rotulo: "contrato de empréstimo" },
  arquivo: { tabela: "doc_empresa_arquivos", rotulo: "arquivo da empresa" },
};

// POST /api/admin/doc-empresa/sigilo
//   { tipo: "extrato"|"fatura"|"emprestimo"|"arquivo", id, nao_compartilhar: bool }
//     → marca/desmarca UM documento como sigiloso (não sai por e-mail/WhatsApp)
//   { banco: "VillelaPay", sigiloso: bool }
//     → marca/desmarca um BANCO/CARTÃO inteiro (vale para o que já existe e o que vier depois)
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const ro = await bloqueioSeSemLeitura(admin, "doc-bancarios"); if (ro) return ro;
    const b = await request.json().catch(() => ({}));
    const db = supabaseAdmin();

    // ── nível BANCO/CARTÃO ──
    if (typeof b.banco === "string" && b.banco.trim()) {
      const banco = b.banco.trim().slice(0, 120);
      const sigiloso = !!b.sigiloso;
      if (sigiloso) {
        const { error } = await db.from("doc_bancos_sigilosos").upsert({ banco, criado_por: admin.email || null }, { onConflict: "banco" });
        if (error) return jsonErr(400, error.message);
      } else {
        const { error } = await db.from("doc_bancos_sigilosos").delete().eq("banco", banco);
        if (error) return jsonErr(400, error.message);
      }
      await registrarAcao(db, { req: request, admin }, {
        acao: "editar", entidade: "doc_bancos_sigilosos", registro_id: banco,
        descricao: `${sigiloso ? "Marcou" : "Desmarcou"} o banco/cartão "${banco}" como sigiloso (fora do compartilhamento)`,
      }).catch(() => {});
      return jsonOk({ ok: true, banco, sigiloso });
    }

    // ── nível ITEM ──
    const cfg = TABELAS[String(b.tipo || "")];
    if (!cfg) return jsonErr(400, "Tipo de documento inválido.");
    const id = String(b.id || "").trim();
    if (!id) return jsonErr(400, "Informe o documento.");
    const nao = !!b.nao_compartilhar;

    const { data: row } = await db.from(cfg.tabela).select("id").eq("id", id).maybeSingle();
    if (!row) return jsonErr(404, "Documento não encontrado.");

    const { error } = await db.from(cfg.tabela).update({ nao_compartilhar: nao }).eq("id", id);
    if (error) return jsonErr(400, error.message);

    await registrarAcao(db, { req: request, admin }, {
      acao: "editar", entidade: cfg.tabela, registro_id: id,
      descricao: `${nao ? "Bloqueou" : "Liberou"} o compartilhamento do ${cfg.rotulo}`,
      dados: { nao_compartilhar: nao },
    }).catch(() => {});

    return jsonOk({ ok: true, id, nao_compartilhar: nao });
  } catch (e: any) {
    const auth = e.message === "Não autenticado" || e.message === "Token inválido";
    return jsonErr(auth ? 401 : 500, e.message || "Falha ao salvar o sigilo.");
  }
};
