import type { APIRoute } from "astro";
import { requireAdminCookie, temPerfil, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";
import { enviarEmailComAnexo } from "../../../../lib/mailer";
import { registrarAcao } from "../../../../lib/auditoria";
import { bloqueioSeSemLeitura } from "../../../../lib/permissoes";

export const prerender = false;
const PERFIS = ["admin", "financeiro", "juridico"];
const MAX_TOTAL = 25 * 1024 * 1024;
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sanitizeNome(s: string) {
  return String(s || "documento").replace(/[/\\:*?"<>| -]/g, "_").replace(/\s+/g, " ").trim().slice(0, 120) || "documento";
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const ro = await bloqueioSeSemLeitura(admin, "doc-bancarios"); if (ro) return ro;
    const b = await request.json();

    const destinos = String(b.to || "").split(/[,;]/).map((s: string) => s.trim()).filter(Boolean);
    if (!destinos.length || !destinos.every((e: string) => EMAIL_RX.test(e)))
      return jsonErr(400, "Informe um ou mais e-mails válidos (separados por vírgula).");
    const items: Array<{ tipo: string; id: string }> = Array.isArray(b.items)
      ? b.items.filter((x: any) => x?.tipo && x?.id)
      : [];
    if (!items.length) return jsonErr(400, "Selecione ao menos um documento.");
    if (items.length > 30) return jsonErr(400, "Máximo de 30 arquivos por e-mail.");
    const assunto = String(b.subject || "").trim() || "Documentos Bancários — Costa Júnior Engenharia";
    const mensagem = String(b.message || "").trim();

    const db = supabaseAdmin();
    const BUCKET = "doc-empresa";
    const exIds = items.filter((i) => i.tipo === "extrato").map((i) => i.id);
    const ftIds = items.filter((i) => i.tipo === "fatura").map((i) => i.id);
    const emIds = items.filter((i) => i.tipo === "emprestimo").map((i) => i.id);

    const rows: Array<{ storage_path: string; label: string }> = [];
    if (exIds.length) {
      const { data } = await db.from("doc_extratos_bancarios").select("id, banco, mes, ano, storage_path, nome_arquivo").in("id", exIds);
      for (const r of (data || []) as any[]) {
        if (r.storage_path) rows.push({ storage_path: r.storage_path, label: r.nome_arquivo || `Extrato ${r.banco} ${String(r.mes).padStart(2,"0")}-${r.ano}` });
      }
    }
    if (ftIds.length) {
      const { data } = await db.from("doc_cartao_faturas").select("id, cartao, mes, ano, storage_path, nome_arquivo").in("id", ftIds);
      for (const r of (data || []) as any[]) {
        if (r.storage_path) rows.push({ storage_path: r.storage_path, label: r.nome_arquivo || `Fatura ${r.cartao} ${String(r.mes).padStart(2,"0")}-${r.ano}` });
      }
    }
    if (emIds.length) {
      const { data } = await db.from("doc_emprestimos").select("id, descricao, banco, storage_path, nome_arquivo").in("id", emIds);
      for (const r of (data || []) as any[]) {
        if (r.storage_path) rows.push({ storage_path: r.storage_path, label: r.nome_arquivo || [r.banco, r.descricao].filter(Boolean).join(" — ") || "Contrato" });
      }
    }
    if (!rows.length) return jsonErr(404, "Nenhum arquivo encontrado para os itens selecionados.");

    const anexos: Array<{ filename: string; content: Buffer }> = [];
    let total = 0;
    for (const r of rows) {
      const { data: blob, error } = await db.storage.from(BUCKET).download(r.storage_path);
      if (error || !blob) continue;
      const buf = Buffer.from(await blob.arrayBuffer());
      total += buf.length;
      if (total > MAX_TOTAL) return jsonErr(413, "Os anexos somam mais de 25 MB. Envie menos documentos por vez.");
      const ext = (r.storage_path.includes(".") ? r.storage_path.split(".").pop() : "pdf")?.toLowerCase().replace(/[^a-z0-9]/g, "") || "pdf";
      anexos.push({ filename: `${sanitizeNome(r.label)}.${ext}`, content: buf });
    }
    if (!anexos.length) return jsonErr(404, "Não foi possível obter os arquivos selecionados.");

    const corpo =
      (mensagem ? `<p style="white-space:pre-wrap">${mensagem.replace(/</g, "&lt;")}</p>` : "") +
      `<p style="margin-top:14px;color:#555">Segue(m) em anexo ${anexos.length} documento(s):</p>` +
      `<ul style="color:#555">${anexos.map((a) => `<li>${a.filename.replace(/</g, "&lt;")}</li>`).join("")}</ul>` +
      `<hr style="border:none;border-top:1px solid #eee;margin:16px 0"/>` +
      `<p style="color:#999;font-size:12px">Enviado por ${(admin.email || "").replace(/</g, "&lt;")} · Costa Júnior Engenharia e Construções</p>`;

    await enviarEmailComAnexo({ to: destinos, subject: assunto, html: corpo, anexos });

    await registrarAcao(db, { req: request, admin }, {
      acao: "criar", entidade: "doc_bancarios_email", registro_id: null,
      descricao: `Enviou ${anexos.length} doc(s) bancário(s) por e-mail para ${destinos.join(", ")}`,
      dados: { to: destinos, arquivos: anexos.map((a) => a.filename) },
    }).catch(() => {});

    return jsonOk({ ok: true, enviados: anexos.length, to: destinos });
  } catch (e: any) {
    const auth = e.message === "Não autenticado" || e.message === "Token inválido";
    return jsonErr(auth ? 401 : 500, e.message || "Falha ao enviar.");
  }
};
