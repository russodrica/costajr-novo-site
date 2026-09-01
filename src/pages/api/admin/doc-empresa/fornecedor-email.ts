import type { APIRoute } from "astro";
import { requireAdminCookie, temPerfil, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin, supabaseAdmin2 } from "../../../../lib/supabase";
import { enviarEmailComAnexo } from "../../../../lib/mailer";
import { registrarAcao } from "../../../../lib/auditoria";
import { bancosSigilosos, linhaEhSigilosa, bancosRestritosExterno, externosPermitidos, podeVerComoExterno } from "../../../../lib/sigilo";
import { acessoFornecedor, bancoLiberado } from "../../../../lib/fornecedorAcesso";

export const prerender = false;

// POST /api/admin/doc-empresa/fornecedor-email
//
// O usuário EXTERNO (contador) manda para o PRÓPRIO e-mail os extratos que ele já
// pode ver e baixar. É conveniência de processo, não ampliação de acesso:
//
//   • o destinatário NÃO vem do pedido — é lido do cadastro dele no banco. Não há
//     como usar isto para mandar documento da empresa para um terceiro;
//   • cada id pedido passa pelas MESMAS peneiras da tela e do download: módulo
//     liberado, banco dentro do escopo dele, documento não escondido;
//   • documento marcado como sigiloso ("não compartilhar") não sai por e-mail —
//     igual à regra que já vale para a equipe interna;
//   • todo envio é registrado na auditoria, com a lista de arquivos.
// Espelha CATS_VEDADAS_FORNECEDOR da rota de download de anexo.
const CATS_VEDADAS = new Set(["Contratos", "Clientes", "Consórcios", "Seguros"]);
const MAX_TOTAL = 25 * 1024 * 1024;
const MAX_ITENS = 30;

function sanitizeNome(s: string) {
  return String(s || "documento").replace(/[/\\:*?"<>| -]/g, "_").replace(/\s+/g, " ").trim().slice(0, 120) || "documento";
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request, { permitirFornecedor: true });
    if (!temPerfil(admin, ["fornecedor"])) return jsonErr(403, "Esta rota é do acesso externo.");

    const db = supabaseAdmin();
    // Destinatário = o e-mail do cadastro. Nunca o que vier no corpo do pedido.
    const { data: perfil } = await db.from("portal_profiles")
      .select("email, display_name").eq("id", admin.sub).maybeSingle();
    const destino = String((perfil as any)?.email || "").trim().toLowerCase();
    if (!destino) return jsonErr(400, "Seu cadastro está sem e-mail. Fale com a Costa Júnior.");

    const b = await request.json().catch(() => ({}));
    // Aceita as duas telas: "extrato" (Documentos Bancários) e "arquivo" (Documentos
    // da Empresa). `ids` puro continua valendo como lista de extratos (compatível).
    const itens: Array<{ tipo: string; id: string }> = Array.isArray(b.itens)
      ? b.itens.filter((x: any) => x?.id).map((x: any) => ({ tipo: String(x.tipo || "extrato"), id: String(x.id) }))
      : (Array.isArray(b.ids) ? b.ids.map((x: any) => ({ tipo: "extrato", id: String(x) })) : []);
    if (!itens.length) return jsonErr(400, "Selecione ao menos um documento.");
    if (itens.length > MAX_ITENS) return jsonErr(400, `Máximo de ${MAX_ITENS} arquivos por e-mail.`);
    const idsEx = itens.filter((i) => i.tipo === "extrato").map((i) => i.id);
    const idsArq = itens.filter((i) => i.tipo === "arquivo").map((i) => i.id);
    const idsFt = itens.filter((i) => i.tipo === "fatura").map((i) => i.id);
    const idsEmp = itens.filter((i) => i.tipo === "emprestimo").map((i) => i.id);

    const [acesso, sigilosos, restritos, permEx, permArq] = await Promise.all([
      acessoFornecedor(db, admin.sub),
      bancosSigilosos(db),
      bancosRestritosExterno(db),
      idsEx.length ? externosPermitidos(db, "doc_extratos_bancarios", idsEx) : Promise.resolve({} as Record<string, string[]>),
      idsArq.length ? externosPermitidos(db, "doc_empresa_arquivos", idsArq) : Promise.resolve({} as Record<string, string[]>),
    ]);
    if ((idsEx.length || idsFt.length || idsEmp.length) && !acesso.docBancarios) return jsonErr(403, "Você não tem acesso aos documentos bancários.");
    if (idsArq.length && !acesso.docEmpresa) return jsonErr(403, "Você não tem acesso aos documentos da empresa.");
    if (idsFt.length && !acesso.faturas) return jsonErr(403, "Você não tem acesso às faturas de cartão.");
    if (idsEmp.length && !acesso.emprestimos) return jsonErr(403, "Você não tem acesso aos empréstimos.");

    const MESES = ["01","02","03","04","05","06","07","08","09","10","11","12"];
    const escolhidos: Array<{ storage_path: string; label: string }> = [];
    let semPermissao = 0, sigilosoBloqueado = 0;

    if (idsEx.length) {
      const { data: rows } = await db.from("doc_extratos_bancarios").select("*").in("id", idsEx);
      for (const r of ((rows || []) as any[])) {
        if (!bancoLiberado(acesso, r.banco)) { semPermissao++; continue; }
        if (!podeVerComoExterno(r, { ehExterno: true, profileId: admin.sub, restritos, permitidos: permEx[String(r.id)] || [] })) { semPermissao++; continue; }
        if (linhaEhSigilosa(r, sigilosos)) { sigilosoBloqueado++; continue; }
        if (!r.storage_path) continue;
        escolhidos.push({
          storage_path: r.storage_path,
          label: r.nome_arquivo || `Extrato ${r.banco} ${MESES[(Number(r.mes) || 1) - 1]}-${r.ano}`,
        });
      }
    }

    if (idsFt.length) {
      const { data: rows } = await db.from("doc_cartao_faturas").select("*").in("id", idsFt);
      const perm = await externosPermitidos(db, "doc_cartao_faturas", idsFt);
      for (const r of ((rows || []) as any[])) {
        if (!bancoLiberado(acesso, r.cartao)) { semPermissao++; continue; }
        if (!podeVerComoExterno(r, { ehExterno: true, profileId: admin.sub, restritos, permitidos: perm[String(r.id)] || [] })) { semPermissao++; continue; }
        if (linhaEhSigilosa(r, sigilosos)) { sigilosoBloqueado++; continue; }
        if (!r.storage_path) continue;
        escolhidos.push({ storage_path: r.storage_path, label: r.nome_arquivo || `Fatura ${r.cartao} ${MESES[(Number(r.mes) || 1) - 1]}-${r.ano}` });
      }
    }

    if (idsEmp.length) {
      const { data: rows } = await db.from("doc_emprestimos").select("*").in("id", idsEmp);
      const perm = await externosPermitidos(db, "doc_emprestimos", idsEmp);
      for (const r of ((rows || []) as any[])) {
        if (!bancoLiberado(acesso, r.banco)) { semPermissao++; continue; }
        if (!podeVerComoExterno(r, { ehExterno: true, profileId: admin.sub, restritos, permitidos: perm[String(r.id)] || [] })) { semPermissao++; continue; }
        if (linhaEhSigilosa(r, sigilosos)) { sigilosoBloqueado++; continue; }
        if (!r.storage_path) continue;
        escolhidos.push({ storage_path: r.storage_path, label: r.nome_arquivo || [r.banco, r.descricao].filter(Boolean).join(" — ") || "Contrato" });
      }
    }

    if (idsArq.length) {
      // Mesmas peneiras da rota de download de anexo: categoria vedada, documento
      // arquivado e restrição a externos derrubam o item aqui também.
      const { data: rows } = await db.from("doc_empresa_arquivos").select("*").in("id", idsArq);
      const arqs = (rows || []) as any[];
      const docIds = [...new Set(arqs.map((a) => a.doc_id).filter(Boolean))];
      let docs: Record<string, any> = {};
      if (docIds.length) {
        const { data: d } = await db.from("doc_empresa").select("id, nome, categoria, arquivado").in("id", docIds);
        docs = Object.fromEntries(((d || []) as any[]).map((x) => [x.id, x]));
      }
      for (const a of arqs) {
        const doc = docs[a.doc_id];
        if (!doc || doc.arquivado || a.arquivado || CATS_VEDADAS.has(doc.categoria || "")) { semPermissao++; continue; }
        if (!podeVerComoExterno(a, { ehExterno: true, profileId: admin.sub, restritos, permitidos: permArq[String(a.id)] || [] })) { semPermissao++; continue; }
        if (a.nao_compartilhar) { sigilosoBloqueado++; continue; }
        if (!a.storage_path) continue;
        escolhidos.push({ storage_path: a.storage_path, label: a.nome || doc.nome || "documento" });
      }
    }
    if (!escolhidos.length) {
      return jsonErr(sigilosoBloqueado ? 403 : 404, sigilosoBloqueado
        ? "Documento marcado como não compartilhável — pode ser consultado no portal, mas não sai por e-mail."
        : "Nenhum arquivo disponível para os itens selecionados.");
    }

    const anexos: Array<{ filename: string; content: Buffer }> = [];
    let total = 0;
    for (const r of escolhidos) {
      const { data: blob, error } = await supabaseAdmin2().storage.from("doc-empresa").download(r.storage_path);
      if (error || !blob) continue;
      const buf = Buffer.from(await blob.arrayBuffer());
      total += buf.length;
      if (total > MAX_TOTAL) return jsonErr(413, "Os anexos somam mais de 25 MB. Envie menos documentos por vez.");
      const ext = (r.storage_path.includes(".") ? r.storage_path.split(".").pop() : "pdf")?.toLowerCase().replace(/[^a-z0-9]/g, "") || "pdf";
      anexos.push({ filename: `${sanitizeNome(r.label)}.${ext}`, content: buf });
    }
    if (!anexos.length) return jsonErr(404, "Não foi possível obter os arquivos selecionados.");

    const corpo =
      `<p style="color:#555">Segue(m) em anexo ${anexos.length} documento(s) que você solicitou no Portal do Fornecedor:</p>` +
      `<ul style="color:#555">${anexos.map((a) => `<li>${a.filename.replace(/</g, "&lt;")}</li>`).join("")}</ul>` +
      `<hr style="border:none;border-top:1px solid #eee;margin:16px 0"/>` +
      `<p style="color:#999;font-size:12px">Envio solicitado por você mesmo(a) no portal · Costa Júnior Engenharia e Construções</p>`;

    await enviarEmailComAnexo({
      to: [destino],
      subject: `Documentos do Portal do Fornecedor — ${anexos.length} arquivo(s)`,
      html: corpo,
      anexos,
    });

    await registrarAcao(db, { req: request, admin }, {
      acao: "criar", entidade: "fornecedor_email", registro_id: null,
      descricao: `Fornecedor ${admin.email} enviou ${anexos.length} documento(s) para o próprio e-mail`,
      dados: { to: destino, arquivos: anexos.map((a) => a.filename), recusados: { semPermissao, sigilosoBloqueado } },
    }).catch(() => {});

    return jsonOk({ ok: true, enviados: anexos.length, to: destino, recusados: semPermissao + sigilosoBloqueado });
  } catch (e: any) {
    const auth = e.message === "Não autenticado" || e.message === "Token inválido";
    return jsonErr(auth ? 401 : 500, e.message || "Falha ao enviar.");
  }
};
