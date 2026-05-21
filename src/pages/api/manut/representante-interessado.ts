import type { APIRoute } from "astro";
import { Resend } from "resend";
import { jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";

export const prerender = false;

const resend = new Resend(import.meta.env.RESEND_API_KEY);
const FROM = import.meta.env.EMAIL_FROM || "onboarding@resend.dev";

/**
 * Recebe cadastro de representante pelo formulário público /indique-e-ganha.
 *
 * Fluxo (com aprovação manual da Adriana):
 * 1) Cria registro em manut_representantes com ativo=false (PENDENTE)
 * 2) Cria 1 cupom único com regras padrão (20% × 2 meses + 10% comissão = caso anual)
 *    também com ativo=false (PENDENTE)
 * 3) Email pra comercial@ com info + link pra aprovar
 * 4) Email confirmando recebimento pro novo representante (SEM citar o cupom — ele só
 *    recebe os códigos depois que Adriana aprovar e ela mesma manda o email comercial)
 *
 * Pra ATIVAR: Adriana vai em /admin/representantes → liga toggle "ativo". Depois em
 * /admin/cupons → ativa o cupom do rep (e ajusta os valores se quiser).
 *
 * Se rep já existir pelo email, NÃO recria — só notifica Adriana que houve nova
 * solicitação (talvez é um rep antigo que esqueceu).
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { nome, telefone, email, mensagem } = body;

    if (!nome || !telefone || !email) {
      return jsonErr(400, "Nome, telefone e e-mail são obrigatórios");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonErr(400, "E-mail inválido");
    }

    const db = supabaseAdmin();
    const emailNorm = email.trim().toLowerCase();

    // ─── 1. Verifica se já existe (mesmo email) ────────────────────
    const { data: existente } = await db
      .from("manut_representantes")
      .select("id, nome, ativo")
      .ilike("email", emailNorm)
      .maybeSingle();

    let representanteId: string;
    let codigoCupom: string | null = null;
    let isNovo = false;
    let avisoExistia = false;

    if (existente) {
      representanteId = existente.id;
      avisoExistia = true;
      // Não recria registro nem cupom — apenas notifica adm que houve nova solicitação.
    } else {
      // ─── 2. Cria representante com ativo=false (PENDENTE) ───────────
      const { data: novo, error } = await db
        .from("manut_representantes")
        .insert({
          nome: nome.trim(),
          email: emailNorm,
          telefone: telefone.trim(),
          saldo_acumulado: 0,
          ativo: false, // 👈 Pendente até Adriana aprovar
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      representanteId = novo.id;
      isNovo = true;

      // ─── 3. Gera código único (slug do nome + 4 chars random) ─────
      const slug = nome
        .toUpperCase()
        .replace(/[ÀÁÂÃÄÅ]/g, "A")
        .replace(/[ÉÈÊË]/g, "E")
        .replace(/[ÍÌÎÏ]/g, "I")
        .replace(/[ÓÒÔÕÖ]/g, "O")
        .replace(/[ÚÙÛÜ]/g, "U")
        .replace(/[Ç]/g, "C")
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 10) || "REP";
      const random = Math.random().toString(36).slice(2, 6).toUpperCase();
      codigoCupom = `INDICA-${slug}-${random}`;

      // ─── 4. Cria 1 cupom único com regras padrão (mais atrativo = anual) ─
      // ativo=false → Adriana aprova depois em /admin/cupons
      const { error: errCupom } = await db.from("manut_cupons").insert({
        codigo: codigoCupom,
        descricao: `Indicação de ${nome.trim()} — aguardando aprovação`,
        desconto_percentual: 20,
        duracao_meses: 2, // Desconto vale por 2 meses (caso anual)
        tipo: "representante",
        representante_id: representanteId,
        cashback_pct: 10, // Comissão padrão (caso anual)
        ativo: false, // 👈 Pendente até Adriana aprovar
      });
      if (errCupom) {
        console.warn("[representante-interessado] falha ao criar cupom:", errCupom.message);
        codigoCupom = null;
      }
    }

    // ─── 5. Email pra Adriana / comercial — com link de aprovação ──
    const corAviso = avisoExistia ? "#92400E" : (isNovo ? "#166534" : "#5B5F6B");
    const bgAviso = avisoExistia ? "#FEF3C7" : "#F0FDF4";
    const borderAviso = avisoExistia ? "#FDE68A" : "#BBF7D0";
    const tituloAviso = avisoExistia
      ? "⚠️ Representante JÁ EXISTIA (mesmo email)"
      : "🤝 Novo cadastro AGUARDANDO APROVAÇÃO";
    const acaoAviso = avisoExistia
      ? `Esse email já está cadastrado em <a href="https://www.costajr.com.br/admin/representantes" style="color:${corAviso};font-weight:700">/admin/representantes</a>. Pode ser uma nova solicitação do mesmo representante ou alguém usando email duplicado. Avalie o caso.`
      : `Acesse <a href="https://www.costajr.com.br/admin/representantes" style="color:${corAviso};font-weight:700">/admin/representantes</a>, valide o perfil e ATIVE o representante (toggle 'ativo'). Depois em <a href="https://www.costajr.com.br/admin/cupons" style="color:${corAviso};font-weight:700">/admin/cupons</a>, ative o cupom <strong>${codigoCupom || "(não foi criado)"}</strong> — ajuste valores se quiser antes de ativar.`;

    const htmlAdmin = `
      <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:32px 24px;background:#fff">
        <div style="border-left:4px solid #C41E3A;padding-left:16px;margin-bottom:24px">
          <h2 style="color:#2D2F36;margin:0 0 4px">${tituloAviso}</h2>
          <p style="color:#5B5F6B;margin:0;font-size:14px">Recebido pelo formulário em costajr.com.br/indique-e-ganha</p>
        </div>

        <table style="width:100%;border-collapse:collapse;font-size:15px;margin-bottom:24px">
          <tr><td style="padding:8px 12px;background:#F4F6F9;font-weight:700;width:140px">Nome</td><td style="padding:8px 12px;border-bottom:1px solid #E5E7EB">${nome}</td></tr>
          <tr><td style="padding:8px 12px;background:#F4F6F9;font-weight:700">Telefone</td><td style="padding:8px 12px;border-bottom:1px solid #E5E7EB"><a href="https://wa.me/55${telefone.replace(/\D/g, "")}" style="color:#C41E3A">${telefone}</a></td></tr>
          <tr><td style="padding:8px 12px;background:#F4F6F9;font-weight:700">E-mail</td><td style="padding:8px 12px;border-bottom:1px solid #E5E7EB"><a href="mailto:${email}" style="color:#C41E3A">${email}</a></td></tr>
        </table>

        ${mensagem ? `
        <div style="margin:24px 0;background:#F4F6F9;padding:16px;border-radius:8px">
          <p style="font-weight:700;margin:0 0 8px;color:#2D2F36;font-size:14px">Como pretende divulgar:</p>
          <p style="margin:0;color:#5B5F6B;white-space:pre-wrap;font-size:14px">${mensagem}</p>
        </div>` : ""}

        ${isNovo && codigoCupom ? `
        <h3 style="color:#2D2F36;margin:24px 0 10px;font-size:16px">Cupom gerado (PENDENTE)</h3>
        <div style="background:#FEF3C7;border:1px solid #FDE68A;border-radius:8px;padding:16px 20px;font-size:14px;color:#92400E;line-height:1.6">
          <p style="margin:0 0 8px"><strong>Código:</strong> <span style="font-family:monospace;font-size:16px">${codigoCupom}</span></p>
          <p style="margin:0 0 4px">Regras padrão (ajuste antes de ativar):</p>
          <ul style="margin:0;padding-left:18px">
            <li>Desconto cliente: 20% × 2 meses</li>
            <li>Comissão representante: 10%</li>
          </ul>
        </div>` : ""}

        <div style="margin-top:24px;padding:14px 18px;background:${bgAviso};border:1px solid ${borderAviso};border-radius:8px">
          <p style="margin:0;color:${corAviso};font-size:14px">${acaoAviso}</p>
        </div>

        <p style="color:#9CA3AF;font-size:12px;margin-top:24px;text-align:center">
          Costa Júnior — Engenharia e Construções Ltda · costajr.com.br
        </p>
      </div>
    `;

    // ─── 6. Email confirmando recebimento pro novo representante ────
    // (Sem citar cupom — ele só recebe depois que adm aprovar e enviar pessoalmente)
    const htmlRep = `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#fff">
        <div style="background:linear-gradient(135deg,#C41E3A 0%,#7A1421 100%);color:#FFF;padding:28px 28px;border-radius:12px;margin-bottom:28px;text-align:center">
          <h1 style="margin:0 0 6px;font-size:22px">Recebemos seu cadastro! 🤝</h1>
          <p style="margin:0;color:#FFB3C0;font-size:14px">Programa Indique e Ganhe — Costa Júnior</p>
        </div>

        <p style="color:#2D2F36;font-size:15.5px;line-height:1.6;margin:0 0 16px">
          Olá <strong>${nome.split(" ")[0]}</strong>! Recebemos sua solicitação pra ser representante do programa de indicação da Costa Júnior.
        </p>

        <p style="color:#5B5F6B;font-size:14.5px;line-height:1.7;margin:0 0 18px">
          Nossa equipe vai avaliar seu cadastro em até <strong>1 dia útil</strong>. Se aprovado, te enviamos por email seu cupom personalizado e as instruções pra começar a divulgar e ganhar comissão.
        </p>

        <div style="background:#F4F6F9;padding:16px 20px;border-radius:8px;margin:24px 0">
          <p style="margin:0 0 6px;font-weight:700;color:#2D2F36;font-size:14px">📋 O que será analisado</p>
          <p style="margin:0;color:#5B5F6B;font-size:13.5px;line-height:1.6">
            Confirmamos seus dados de contato, validamos o perfil pra evitar conflito com clientes atuais, e preparamos seu cupom personalizado.
          </p>
        </div>

        <p style="color:#5B5F6B;font-size:14px;line-height:1.6;margin:24px 0 0">
          Qualquer dúvida, chame a gente no WhatsApp: <a href="https://wa.me/551123696462" style="color:#C41E3A;font-weight:600">(11) 2369-6462</a>
        </p>

        <p style="color:#9CA3AF;font-size:11px;text-align:center;margin-top:32px;padding-top:16px;border-top:1px solid #E5E7EB">
          Costa Júnior Engenharia e Construções Ltda · CNPJ 07.132.942/0001-72<br>
          Você recebeu este email porque se cadastrou em costajr.com.br/indique-e-ganha
        </p>
      </div>
    `;

    await Promise.allSettled([
      resend.emails.send({
        from: `Costa Júnior <${FROM}>`,
        to: "comercial@costajr.com.br",
        replyTo: email,
        subject: `[Indique e Ganhe] ${avisoExistia ? "⚠️ DUPLICADO" : "🤝 NOVO"}: ${nome} — aprovar?`,
        html: htmlAdmin,
      }),
      resend.emails.send({
        from: `Costa Júnior <${FROM}>`,
        to: email,
        replyTo: "comercial@costajr.com.br",
        subject: "🤝 Recebemos seu cadastro — Indique e Ganhe Costa Júnior",
        html: htmlRep,
      }),
    ]);

    return jsonOk({ ok: true, pendente: true, jaExistia: avisoExistia });
  } catch (e: any) {
    console.error("[representante-interessado] erro:", e);
    return jsonErr(500, e.message || "Erro ao processar");
  }
};
