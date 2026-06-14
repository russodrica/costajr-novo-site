import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { jsonOk, jsonErr } from "~/lib/auth";

export const prerender = false;

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const EXT_POR_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "image/jpeg": "jpg",
  "image/png": "png",
};
// campos que o candidato pode mandar no formulário público
const CAMPOS_PUB = ["nome", "email", "telefone", "data_nascimento", "experiencia", "formacao",
  "conhecimento_tecnologico", "possui_habilitacao", "possui_veiculo", "disp_imediata", "disp_viagem", "disp_presencial", "restricao"];
const BOOL_PUB = ["possui_habilitacao", "possui_veiculo", "disp_imediata", "disp_viagem", "disp_presencial"];
const coagir = (v: any) => (v === true || v === "true" || v === "sim" ? true : (v === false || v === "false" || v === "nao" ? false : null));

// POST /api/vagas/candidatar  — PÚBLICO (candidato se inscreve no site).
// multipart/form-data: campos + vaga_id (opcional) + arquivo (currículo opcional).
// vaga_id vazio = candidatura espontânea → Banco de Talentos.
export const POST: APIRoute = async ({ request }) => {
  try {
    const db = supabaseAdmin();
    const form = await request.formData().catch(() => null);
    if (!form) return jsonErr(400, "Envie o formulário (multipart/form-data).");

    const nome = String(form.get("nome") || "").trim();
    const email = String(form.get("email") || "").trim();
    const telefone = String(form.get("telefone") || "").trim();
    if (!nome) return jsonErr(400, "Informe seu nome.");
    if (!email && !telefone) return jsonErr(400, "Informe ao menos um e-mail ou telefone para contato.");

    const vagaIdRaw = String(form.get("vaga_id") || "").trim();
    let vagaId: string | null = null;
    let vagaTitulo = "";
    if (vagaIdRaw) {
      const { data: vaga } = await db.from("rh_vagas").select("id, titulo, status").eq("id", vagaIdRaw).maybeSingle();
      if (!vaga) return jsonErr(404, "Vaga não encontrada.");
      if (!["aberta", "em_andamento"].includes(vaga.status)) return jsonErr(400, "Esta vaga não está mais recebendo candidaturas.");
      vagaId = vaga.id; vagaTitulo = vaga.titulo;
    }

    const row: Record<string, any> = {
      nome, etapa: "triagem", criado_por: "site",
      origem: vagaId ? `Site — ${vagaTitulo}`.slice(0, 120) : "Banco de Talentos (site)",
    };
    if (vagaId) row.vaga_id = vagaId;
    for (const c of CAMPOS_PUB) {
      const v = form.get(c);
      if (v === null || String(v).trim() === "") continue;
      row[c] = BOOL_PUB.includes(c) ? coagir(v) : String(v).slice(0, 4000);
    }

    const { data: cand, error } = await db.from("rh_candidatos").insert(row).select("id, nome").single();
    if (error) return jsonErr(400, error.message);

    // currículo opcional → bucket privado "rh"
    const arquivo = form.get("arquivo");
    if (arquivo instanceof File && arquivo.size > 0) {
      if (arquivo.size > MAX_BYTES) return jsonOk({ id: cand.id, aviso: "Inscrição registrada, mas o currículo passou de 10 MB e não foi anexado." }, 201);
      const ct = arquivo.type || "application/octet-stream";
      const ok = ct === "application/pdf" || ct.startsWith("image/") || ct.includes("word") || ct.includes("officedocument");
      if (ok) {
        const nomeOrig = (arquivo.name || "").slice(0, 150);
        let ext = (nomeOrig.includes(".") ? nomeOrig.split(".").pop() : "")?.toLowerCase().replace(/[^a-z0-9]/g, "") || "";
        if (!ext || ext.length > 5) ext = EXT_POR_MIME[ct] || "pdf";
        const path = `candidatos/${cand.id}/curriculo-${Date.now()}.${ext}`;
        const bytes = await arquivo.arrayBuffer();
        const { error: errUp } = await db.storage.from("rh").upload(path, bytes, { contentType: ct, upsert: false });
        if (!errUp) await db.from("rh_candidatos").update({ curriculo_path: path, curriculo_nome: nomeOrig || `curriculo.${ext}` }).eq("id", cand.id);
      }
    }

    // notifica o RH (não bloqueia a resposta ao candidato)
    try {
      const { enviarEmailSimples } = await import("~/lib/mailer");
      const dest = import.meta.env.RH_ALERT_EMAIL || "rh@costajr.com.br";
      await enviarEmailSimples({
        to: dest,
        subject: `🧑‍💼 Nova candidatura: ${nome}${vagaTitulo ? ` — ${vagaTitulo}` : " (Banco de Talentos)"}`,
        html: `<div style="font-family:Arial,sans-serif;color:#2D2F36">
          <h2 style="color:#C41E3A">Nova candidatura pelo site</h2>
          <p><strong>${nome}</strong>${email ? ` · ${email}` : ""}${telefone ? ` · ${telefone}` : ""}</p>
          <p>Vaga: <strong>${vagaTitulo || "Banco de Talentos (espontânea)"}</strong></p>
          <p><a href="${import.meta.env.SITE_BASE_URL || "https://costajr.com.br"}/admin/recrutamento" style="background:#C41E3A;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px">Ver no recrutamento</a></p>
        </div>`,
      }).catch(() => {});
    } catch { /* email nunca derruba a inscrição */ }

    try {
      const { enviarTelegram, escTg } = await import("~/lib/telegram");
      await enviarTelegram(`🧑‍💼 <b>Nova candidatura</b>\n${escTg(nome)}${vagaTitulo ? ` — ${escTg(vagaTitulo)}` : " (Banco de Talentos)"}${email ? `\n${escTg(email)}` : ""}${telefone ? ` · ${escTg(telefone)}` : ""}`, { canal: "ADM" });
    } catch { /* best-effort */ }

    return jsonOk({ id: cand.id, ok: true }, 201);
  } catch (e: any) {
    return jsonErr(500, e.message);
  }
};
