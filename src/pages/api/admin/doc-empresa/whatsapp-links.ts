import type { APIRoute } from "astro";
import { requireAdminCookie, temPerfil, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin, supabaseAdmin2 } from "../../../../lib/supabase";
import { registrarAcao } from "../../../../lib/auditoria";
import { bloqueioSeSemLeitura } from "../../../../lib/permissoes";

export const prerender = false;
const PERFIS = ["admin", "financeiro", "juridico", "comercial"];
const EXPIRA = 3 * 24 * 60 * 60; // 3 dias (o WhatsApp não anexa arquivo — mandamos LINKS temporários)

// POST /api/admin/doc-empresa/whatsapp-links  { arquivo_ids: string[] }
// Gera URLs assinadas (bucket privado) e devolve uma MENSAGEM pronta p/ o WhatsApp.
// O usuário abre o wa.me com esse texto e escolhe o contato. (LGPD: quem tiver o link acessa.)
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const ro = await bloqueioSeSemLeitura(admin, "doc-empresa"); if (ro) return ro;
    const b = await request.json();
    const ids: string[] = Array.isArray(b.arquivo_ids) ? b.arquivo_ids.filter(Boolean) : [];
    if (!ids.length) return jsonErr(400, "Selecione ao menos um documento.");
    if (ids.length > 20) return jsonErr(400, "Máximo de 20 documentos por vez no WhatsApp.");

    const db = supabaseAdmin();
    const { data: todas } = await db.from("doc_empresa_arquivos").select("*").in("id", ids);
    // Sigilosos são barrados AQUI, no servidor — o link nem chega a ser gerado.
    const bloqueados = ((todas || []) as any[]).filter((r) => r.nao_compartilhar).length;
    const rows = ((todas || []) as any[]).filter((r) => !r.nao_compartilhar);
    if (!rows.length) {
      return jsonErr(bloqueados ? 403 : 404, bloqueados
        ? `Documento sigiloso: ${bloqueados === 1 ? "o documento selecionado está marcado" : `os ${bloqueados} documentos selecionados estão marcados`} como "não compartilhar" e não pode${bloqueados === 1 ? "" : "m"} ser enviado${bloqueados === 1 ? "" : "s"}.`
        : "Arquivos não encontrados.");
    }
    const docIds = [...new Set((rows as any[]).map((r) => r.doc_id).filter(Boolean))];
    const { data: docs } = await db.from("doc_empresa").select("id, nome").in("id", docIds);
    const docNome: Record<string, string> = Object.fromEntries(((docs || []) as any[]).map((d) => [d.id, d.nome]));

    const seguro = (s: string) => String(s || "").replace(/[*_~`]/g, "​$&"); // neutraliza markdown do WhatsApp
    const linhas: string[] = [];
    const nomes: string[] = [];
    for (const r of rows as any[]) {
      if (!r.storage_path) continue;
      const { data: signed } = await supabaseAdmin2().storage.from("doc-empresa").createSignedUrl(r.storage_path, EXPIRA);
      if (!signed?.signedUrl) continue;
      const nome = docNome[r.doc_id] && docNome[r.doc_id] !== r.nome ? `${docNome[r.doc_id]} — ${r.nome}` : r.nome;
      nomes.push(nome);
      linhas.push(`📄 ${seguro(nome)}\n${signed.signedUrl}`);
    }
    if (!linhas.length) return jsonErr(404, "Não foi possível gerar os links dos documentos.");
    const pulados = ids.length - linhas.length;

    const message = `*Documentos — Costa Júnior Engenharia*\n\n${linhas.join("\n\n")}\n\n_Links válidos por 3 dias._`;

    await registrarAcao(db, { req: request, admin }, {
      acao: "criar", entidade: "doc_empresa_whatsapp", registro_id: null,
      descricao: `Gerou links de WhatsApp para ${linhas.length} documento(s)`, dados: { qtd: linhas.length, documentos: nomes },
    }).catch(() => {});

    return jsonOk({ ok: true, message, count: linhas.length, pedidos: ids.length, pulados });
  } catch (e: any) {
    const auth = e.message === "Não autenticado" || e.message === "Token inválido";
    return jsonErr(auth ? 401 : 500, e.message || "Falha ao gerar links.");
  }
};
