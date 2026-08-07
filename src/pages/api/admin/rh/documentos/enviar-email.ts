import type { APIRoute } from "astro";
import { requireAdminCookie, temPerfil, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { enviarEmailComAnexo } from "../../../../../lib/mailer";
import { registrarAcao } from "../../../../../lib/auditoria";
import { bloqueioSeSemLeitura } from "../../../../../lib/permissoes";
import { TIPO_DOC_LABEL as TIPO_LABEL } from "../../../../../lib/rhTiposDoc";

export const prerender = false;
// Documento de RH é dado PESSOAL do colaborador (LGPD): só admin e RH enviam.
const PERFIS = ["admin", "rh"];
const MAX_TOTAL = 25 * 1024 * 1024; // limite seguro do Resend
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;


function sanitizeNome(s: string) {
  return String(s || "documento").replace(/[/\\:*?"<>| -]/g, "_").replace(/\s+/g, " ").trim().slice(0, 120) || "documento";
}

// POST /api/admin/rh/documentos/enviar-email
//   { to, subject, message, documento_ids: string[] }
// Manda os arquivos ANEXADOS no próprio e-mail — de propósito não existe versão
// WhatsApp aqui: link temporário de documento de funcionário pode ser repassado.
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const ro = await bloqueioSeSemLeitura(admin, "rh"); if (ro) return ro;
    const b = await request.json();

    const destinos = String(b.to || "").split(/[,;]/).map((s: string) => s.trim()).filter(Boolean);
    if (!destinos.length || !destinos.every((e: string) => EMAIL_RX.test(e)))
      return jsonErr(400, "Informe um ou mais e-mails válidos (separados por vírgula).");
    const ids: string[] = Array.isArray(b.documento_ids) ? b.documento_ids.filter(Boolean) : [];
    if (!ids.length) return jsonErr(400, "Selecione ao menos um documento.");
    if (ids.length > 30) return jsonErr(400, "Máximo de 30 arquivos por e-mail.");
    const assunto = String(b.subject || "").trim() || "Documentos — Costa Júnior Engenharia";
    const mensagem = String(b.message || "").trim();

    const db = supabaseAdmin();
    const { data: rows } = await db.from("rh_documentos")
      .select("id, titulo, tipo, storage_path, colaborador_id, rh_colaboradores(nome)")
      .in("id", ids);
    if (!rows || !rows.length) return jsonErr(404, "Documentos não encontrados.");

    const anexos: Array<{ filename: string; content: Buffer }> = [];
    const enviados: string[] = [];
    let total = 0;
    let semArquivo = 0;
    for (const r of rows as any[]) {
      // documento que é só link externo não tem arquivo para anexar
      if (!r.storage_path) { semArquivo++; continue; }
      const { data: blob, error } = await db.storage.from("rh").download(r.storage_path);
      if (error || !blob) { semArquivo++; continue; }
      const buf = Buffer.from(await blob.arrayBuffer());
      total += buf.length;
      if (total > MAX_TOTAL) return jsonErr(413, "Os anexos somam mais de 25 MB. Envie menos documentos por vez.");
      const ext = (String(r.storage_path).includes(".") ? String(r.storage_path).split(".").pop() : "pdf")?.toLowerCase().replace(/[^a-z0-9]/g, "") || "pdf";
      const pessoa = r.rh_colaboradores?.nome || "";
      const rotulo = [pessoa, TIPO_LABEL[r.tipo] || "Documento", r.titulo].filter(Boolean).join(" - ");
      anexos.push({ filename: `${sanitizeNome(rotulo)}.${ext}`, content: buf });
      enviados.push(rotulo);
    }
    if (!anexos.length) {
      return jsonErr(404, semArquivo
        ? "Os documentos selecionados não têm arquivo anexado (só link externo)."
        : "Não foi possível obter os arquivos selecionados.");
    }

    const corpo =
      (mensagem ? `<p style="white-space:pre-wrap">${mensagem.replace(/</g, "&lt;")}</p>` : "") +
      `<p style="margin-top:14px;color:#555">Segue(m) em anexo ${anexos.length} documento(s):</p>` +
      `<ul style="color:#555">${anexos.map((a) => `<li>${a.filename.replace(/</g, "&lt;")}</li>`).join("")}</ul>` +
      `<hr style="border:none;border-top:1px solid #eee;margin:16px 0"/>` +
      `<p style="color:#999;font-size:12px">Enviado por ${(admin.email || "").replace(/</g, "&lt;")} · Costa Júnior Engenharia e Construções</p>` +
      `<p style="color:#999;font-size:11.5px">Documentos de colaborador — uso restrito. Não repasse sem necessidade.</p>`;

    await enviarEmailComAnexo({ to: destinos, subject: assunto, html: corpo, anexos });

    // Auditoria detalhada: documento de pessoal exige saber quem mandou o quê, para quem.
    await registrarAcao(db, { req: request, admin }, {
      acao: "criar", entidade: "rh_documentos_email", registro_id: null,
      descricao: `Enviou ${anexos.length} documento(s) de RH por e-mail para ${destinos.join(", ")}`,
      dados: { to: destinos, documentos: enviados, ids },
    }).catch(() => {});

    return jsonOk({ ok: true, enviados: anexos.length, to: destinos, semArquivo });
  } catch (e: any) {
    const auth = e.message === "Não autenticado" || e.message === "Token inválido";
    return jsonErr(auth ? 401 : 500, e.message || "Falha ao enviar.");
  }
};
