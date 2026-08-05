import type { APIRoute } from "astro";
import { requireAdminCookie, temPerfil, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin, supabaseAdmin2 } from "../../../../lib/supabase";
import { registrarAcao } from "../../../../lib/auditoria";
import { bloqueioSeSemLeitura } from "../../../../lib/permissoes";
import { bancosSigilosos, linhaEhSigilosa } from "../../../../lib/sigilo";

export const prerender = false;
const PERFIS = ["admin", "financeiro", "juridico"];
const EXPIRA = 3 * 24 * 60 * 60; // 3 dias

// POST /api/admin/doc-empresa/bancarios-whatsapp  { items: [{tipo,id}] }
// Gera links assinados dos documentos bancários e devolve a mensagem pronta p/ o WhatsApp.
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const ro = await bloqueioSeSemLeitura(admin, "doc-bancarios"); if (ro) return ro;
    const b = await request.json();
    const items: Array<{ tipo: string; id: string }> = Array.isArray(b.items) ? b.items.filter((x: any) => x?.tipo && x?.id) : [];
    if (!items.length) return jsonErr(400, "Selecione ao menos um documento.");
    if (items.length > 20) return jsonErr(400, "Máximo de 20 documentos por vez no WhatsApp.");

    const db = supabaseAdmin();
    const BUCKET = "doc-empresa";
    const exIds = items.filter((i) => i.tipo === "extrato").map((i) => i.id);
    const ftIds = items.filter((i) => i.tipo === "fatura").map((i) => i.id);
    const emIds = items.filter((i) => i.tipo === "emprestimo").map((i) => i.id);

    // Sigilosos (item ou banco inteiro) são barrados AQUI, no servidor — link nem chega a ser gerado.
    const sigilosos = await bancosSigilosos(db);
    let bloqueados = 0;

    const rows: Array<{ storage_path: string; label: string }> = [];
    if (exIds.length) {
      const { data } = await db.from("doc_extratos_bancarios").select("*").in("id", exIds);
      for (const r of (data || []) as any[]) { if (linhaEhSigilosa(r, sigilosos)) { bloqueados++; continue; } if (r.storage_path) rows.push({ storage_path: r.storage_path, label: r.nome_arquivo || `Extrato ${r.banco} ${String(r.mes).padStart(2, "0")}-${r.ano}` }); }
    }
    if (ftIds.length) {
      const { data } = await db.from("doc_cartao_faturas").select("*").in("id", ftIds);
      for (const r of (data || []) as any[]) { if (linhaEhSigilosa(r, sigilosos)) { bloqueados++; continue; } if (r.storage_path) rows.push({ storage_path: r.storage_path, label: r.nome_arquivo || `Fatura ${r.cartao} ${String(r.mes).padStart(2, "0")}-${r.ano}` }); }
    }
    if (emIds.length) {
      const { data } = await db.from("doc_emprestimos").select("*").in("id", emIds);
      for (const r of (data || []) as any[]) { if (linhaEhSigilosa(r, sigilosos)) { bloqueados++; continue; } if (r.storage_path) rows.push({ storage_path: r.storage_path, label: r.nome_arquivo || [r.banco, r.descricao].filter(Boolean).join(" — ") || "Contrato" }); }
    }
    if (!rows.length) {
      return jsonErr(bloqueados ? 403 : 404, bloqueados
        ? `Documento sigiloso: ${bloqueados === 1 ? "o documento selecionado está marcado" : `os ${bloqueados} documentos selecionados estão marcados`} como "não compartilhar" e não pode${bloqueados === 1 ? "" : "m"} ser enviado${bloqueados === 1 ? "" : "s"}.`
        : "Nenhum arquivo encontrado para os itens selecionados.");
    }

    const seguro = (s: string) => String(s || "").replace(/[*_~`]/g, "​$&"); // neutraliza markdown do WhatsApp
    const linhas: string[] = [];
    const labels: string[] = [];
    for (const r of rows) {
      const { data: signed } = await supabaseAdmin2().storage.from(BUCKET).createSignedUrl(r.storage_path, EXPIRA);
      if (!signed?.signedUrl) continue;
      labels.push(r.label);
      linhas.push(`📄 ${seguro(r.label)}\n${signed.signedUrl}`);
    }
    if (!linhas.length) return jsonErr(404, "Não foi possível gerar os links dos documentos.");
    const pulados = items.length - linhas.length;

    const message = `*Documentos Bancários — Costa Júnior Engenharia*\n\n${linhas.join("\n\n")}\n\n_Links válidos por 3 dias._`;

    await registrarAcao(db, { req: request, admin }, {
      acao: "criar", entidade: "doc_bancarios_whatsapp", registro_id: null,
      descricao: `Gerou links de WhatsApp para ${linhas.length} documento(s) bancário(s)`, dados: { qtd: linhas.length, documentos: labels },
    }).catch(() => {});

    return jsonOk({ ok: true, message, count: linhas.length, pedidos: items.length, pulados });
  } catch (e: any) {
    const auth = e.message === "Não autenticado" || e.message === "Token inválido";
    return jsonErr(auth ? 401 : 500, e.message || "Falha ao gerar links.");
  }
};
