import type { APIRoute } from "astro";
import { Resend } from "resend";

export const prerender = false;

const resend = new Resend(import.meta.env.RESEND_API_KEY);
const FROM = import.meta.env.EMAIL_FROM || "onboarding@resend.dev";
const FROM_SAFE = FROM === "contato@costajr.com.br" ? "onboarding@resend.dev" : FROM;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { nome, empresa, cargo, email, telefone, tipo, localizacao, mensagem } = body;

    if (!nome || !email || !telefone || !tipo || !mensagem) {
      return new Response(JSON.stringify({ ok: false, error: "Campos obrigatórios ausentes" }), { status: 400 });
    }

    const tipoLabel: Record<string, string> = {
      construcao: "Construção / Reforma",
      manutencao: "Manutenção predial",
      fundacao: "Fundação / Contenção",
      projeto: "Projeto / Consultoria",
      fiscalizacao: "Fiscalização técnica",
      outro: "Outro",
    };

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;background:#fff">
        <div style="border-left:4px solid #C41E3A;padding-left:16px;margin-bottom:28px">
          <h2 style="color:#2D2F36;margin:0 0 4px">Nova solicitação de orçamento</h2>
          <p style="color:#5B5F6B;margin:0;font-size:14px">Recebida pelo site costajr.com.br</p>
        </div>

        <table style="width:100%;border-collapse:collapse;font-size:15px">
          <tr><td style="padding:8px 12px;background:#F4F6F9;font-weight:700;width:140px">Nome</td><td style="padding:8px 12px;border-bottom:1px solid #E5E7EB">${nome}</td></tr>
          ${empresa ? `<tr><td style="padding:8px 12px;background:#F4F6F9;font-weight:700">Empresa</td><td style="padding:8px 12px;border-bottom:1px solid #E5E7EB">${empresa}${cargo ? ` — ${cargo}` : ""}</td></tr>` : ""}
          <tr><td style="padding:8px 12px;background:#F4F6F9;font-weight:700">E-mail</td><td style="padding:8px 12px;border-bottom:1px solid #E5E7EB"><a href="mailto:${email}" style="color:#C41E3A">${email}</a></td></tr>
          <tr><td style="padding:8px 12px;background:#F4F6F9;font-weight:700">Telefone</td><td style="padding:8px 12px;border-bottom:1px solid #E5E7EB">${telefone}</td></tr>
          <tr><td style="padding:8px 12px;background:#F4F6F9;font-weight:700">Tipo</td><td style="padding:8px 12px;border-bottom:1px solid #E5E7EB">${tipoLabel[tipo] || tipo}</td></tr>
          ${localizacao ? `<tr><td style="padding:8px 12px;background:#F4F6F9;font-weight:700">Localização</td><td style="padding:8px 12px;border-bottom:1px solid #E5E7EB">${localizacao}</td></tr>` : ""}
        </table>

        <div style="margin-top:24px;background:#F4F6F9;padding:20px;border-radius:8px">
          <p style="font-weight:700;margin:0 0 10px;color:#2D2F36">Mensagem:</p>
          <p style="margin:0;color:#5B5F6B;white-space:pre-wrap">${mensagem}</p>
        </div>

        <p style="color:#9CA3AF;font-size:12px;margin-top:32px">
          Costa Júnior — Engenharia e Construções Ltda · costajr.com.br
        </p>
      </div>
    `;

    await resend.emails.send({
      from: `Site Costa Júnior <${FROM_SAFE}>`,
      to: "comercial@costajr.com.br",
      replyTo: email,
      subject: `[Site] ${tipoLabel[tipo] || tipo} — ${nome}`,
      html,
    });

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (e: any) {
    console.error("contato api error:", e);
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500 });
  }
};
