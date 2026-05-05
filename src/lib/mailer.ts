import { Resend } from "resend";

const resend = new Resend(import.meta.env.RESEND_API_KEY);
const FROM = import.meta.env.EMAIL_FROM || "onboarding@resend.dev";
// Resend só aceita domínios verificados. Enquanto costajr.com.br não for verificado,
// usar o remetente padrão do Resend (onboarding@resend.dev).
const FROM_SAFE = FROM === "contato@costajr.com.br" ? "onboarding@resend.dev" : FROM;
const SITE = import.meta.env.SITE_BASE_URL || "https://costajr.com.br";

export async function enviarSenhaTemporaria(email: string, nome: string, senha: string) {
  await resend.emails.send({
    from: `Costa Júnior <${FROM_SAFE}>`,
    to: email,
    subject: "Sua senha temporária — Portal Costa Júnior",
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#fff">
        <img src="${SITE}/logo-cjr.png" alt="Costa Júnior" style="height:48px;margin-bottom:24px">
        <h2 style="color:#2D2F36;margin:0 0 8px">Olá, ${nome}!</h2>
        <p style="color:#5B5F6B;margin:0 0 24px">Sua senha temporária de acesso ao Portal do Cliente é:</p>
        <div style="background:#F4F6F9;border-radius:8px;padding:20px;text-align:center;margin-bottom:24px">
          <span style="font-size:28px;font-weight:700;letter-spacing:0.1em;color:#C41E3A">${senha}</span>
        </div>
        <p style="color:#5B5F6B;margin:0 0 24px">Ao entrar, você será solicitado a criar uma nova senha pessoal.</p>
        <a href="${SITE}/manutencao/cliente/login"
           style="display:inline-block;background:#C41E3A;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:700;font-size:15px">
          Acessar o portal
        </a>
        <p style="color:#9CA3AF;font-size:12px;margin-top:32px">
          Se você não solicitou este acesso, ignore este email.<br>
          Costa Júnior — Engenharia e Construções Ltda
        </p>
      </div>
    `,
  });
}

export async function enviarSenhaReset(email: string, nome: string, senha: string) {
  await resend.emails.send({
    from: `Costa Júnior <${FROM_SAFE}>`,
    to: email,
    subject: "Recuperação de senha — Portal Costa Júnior",
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#fff">
        <img src="${SITE}/logo-cjr.png" alt="Costa Júnior" style="height:48px;margin-bottom:24px">
        <h2 style="color:#2D2F36;margin:0 0 8px">Olá, ${nome}!</h2>
        <p style="color:#5B5F6B;margin:0 0 24px">Recebemos uma solicitação de recuperação de senha para sua conta. Sua nova senha temporária é:</p>
        <div style="background:#F4F6F9;border-radius:8px;padding:20px;text-align:center;margin-bottom:24px">
          <span style="font-size:28px;font-weight:700;letter-spacing:0.1em;color:#C41E3A">${senha}</span>
        </div>
        <p style="color:#5B5F6B;margin:0 0 24px">Ao entrar, você será solicitado a criar uma nova senha pessoal.</p>
        <a href="${SITE}/manutencao/cliente/login"
           style="display:inline-block;background:#C41E3A;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:700;font-size:15px">
          Acessar o portal
        </a>
        <p style="color:#9CA3AF;font-size:12px;margin-top:32px">
          Se você não solicitou esta recuperação, ignore este email.<br>
          Costa Júnior — Engenharia e Construções Ltda
        </p>
      </div>
    `,
  });
}
