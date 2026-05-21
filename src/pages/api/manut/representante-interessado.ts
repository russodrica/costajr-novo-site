import type { APIRoute } from "astro";
import { Resend } from "resend";
import { jsonOk, jsonErr } from "~/lib/auth";

export const prerender = false;

const resend = new Resend(import.meta.env.RESEND_API_KEY);
const FROM = import.meta.env.EMAIL_FROM || "onboarding@resend.dev";

/**
 * Recebe interesse em ser representante do programa "Indique e Ganhe".
 * Envia email pra comercial@ pra Adriana fazer follow-up e criar o cadastro
 * formal de representante no painel admin (/admin/representantes).
 *
 * Não cria registro automático em manut_representantes pra evitar spam.
 * Adriana qualifica via WhatsApp/email antes de criar o cadastro.
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

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;background:#fff">
        <div style="border-left:4px solid #C41E3A;padding-left:16px;margin-bottom:28px">
          <h2 style="color:#2D2F36;margin:0 0 4px">🤝 Novo interesse no programa "Indique e Ganhe"</h2>
          <p style="color:#5B5F6B;margin:0;font-size:14px">Recebido pelo formulário em costajr.com.br/indique-e-ganha</p>
        </div>

        <table style="width:100%;border-collapse:collapse;font-size:15px">
          <tr><td style="padding:8px 12px;background:#F4F6F9;font-weight:700;width:140px">Nome</td><td style="padding:8px 12px;border-bottom:1px solid #E5E7EB">${nome}</td></tr>
          <tr><td style="padding:8px 12px;background:#F4F6F9;font-weight:700">Telefone</td><td style="padding:8px 12px;border-bottom:1px solid #E5E7EB"><a href="https://wa.me/55${telefone.replace(/\D/g, "")}" style="color:#C41E3A">${telefone}</a></td></tr>
          <tr><td style="padding:8px 12px;background:#F4F6F9;font-weight:700">E-mail</td><td style="padding:8px 12px;border-bottom:1px solid #E5E7EB"><a href="mailto:${email}" style="color:#C41E3A">${email}</a></td></tr>
        </table>

        ${mensagem ? `
        <div style="margin-top:24px;background:#F4F6F9;padding:20px;border-radius:8px">
          <p style="font-weight:700;margin:0 0 10px;color:#2D2F36">Como pretende divulgar:</p>
          <p style="margin:0;color:#5B5F6B;white-space:pre-wrap">${mensagem}</p>
        </div>` : ""}

        <div style="margin-top:32px;padding:16px 20px;background:#FEF3C7;border:1px solid #FDE68A;border-radius:8px">
          <p style="margin:0;color:#92400E;font-size:14px">
            <strong>Próximo passo:</strong> faça contato em até 1 dia útil para validar perfil e, se aprovado, criar o cadastro formal em
            <a href="https://www.costajr.com.br/admin/representantes" style="color:#92400E;font-weight:700">/admin/representantes</a>.
            Depois, criar o cupom de indicação personalizado em /admin/cupons vinculado a este representante.
          </p>
        </div>

        <p style="color:#9CA3AF;font-size:12px;margin-top:32px;text-align:center">
          Costa Júnior — Engenharia e Construções Ltda · costajr.com.br
        </p>
      </div>
    `;

    await resend.emails.send({
      from: `Site Costa Júnior <${FROM}>`,
      to: "comercial@costajr.com.br",
      replyTo: email,
      subject: `[Indique e Ganhe] Novo interessado: ${nome}`,
      html,
    });

    return jsonOk({ ok: true });
  } catch (e: any) {
    console.error("[representante-interessado] erro:", e);
    return jsonErr(500, e.message || "Erro ao processar");
  }
};
