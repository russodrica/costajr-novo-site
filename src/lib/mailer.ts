import { Resend } from "resend";

const RESEND_API_KEY = import.meta.env.RESEND_API_KEY;
const FROM = import.meta.env.EMAIL_FROM || "onboarding@resend.dev";
const SITE = import.meta.env.SITE_BASE_URL || "https://costajr.com.br";

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

async function sendOrThrow(payload: { to: string; subject: string; html: string }) {
  if (!resend) throw new Error("RESEND_API_KEY ausente — configure no .env / Vercel");
  const { data, error } = await resend.emails.send({
    from: `Costa Júnior <${FROM}>`,
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
  });
  if (error) throw new Error(`Resend: ${error.message || JSON.stringify(error)}`);
  return data;
}

function htmlSenha(nome: string, senha: string, contexto: "boas-vindas" | "reset") {
  const titulo = contexto === "boas-vindas" ? "Sua senha temporária" : "Recuperação de senha";
  const subtitulo = contexto === "boas-vindas"
    ? "Sua senha temporária de acesso ao Portal do Cliente é:"
    : "Recebemos uma solicitação de recuperação de senha para sua conta. Sua nova senha temporária é:";
  const rodape = contexto === "boas-vindas"
    ? "Se você não solicitou este acesso, ignore este email."
    : "Se você não solicitou esta recuperação, ignore este email.";
  return `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#fff">
      <img src="${SITE}/logo-cjr.png" alt="Costa Júnior" style="height:48px;margin-bottom:24px">
      <h2 style="color:#2D2F36;margin:0 0 8px">Olá, ${nome}!</h2>
      <p style="color:#5B5F6B;margin:0 0 24px">${subtitulo}</p>
      <div style="background:#F4F6F9;border-radius:8px;padding:20px;text-align:center;margin-bottom:24px">
        <span style="font-size:28px;font-weight:700;letter-spacing:0.1em;color:#C41E3A">${senha}</span>
      </div>
      <p style="color:#5B5F6B;margin:0 0 24px">Ao entrar, você será solicitado a criar uma nova senha pessoal.</p>
      <a href="${SITE}/manutencao/cliente/login"
         style="display:inline-block;background:#C41E3A;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:700;font-size:15px">
        Acessar o portal
      </a>
      <p style="color:#9CA3AF;font-size:12px;margin-top:32px">
        ${rodape}<br>
        Costa Júnior — Engenharia e Construções Ltda
      </p>
    </div>
  `;
}

export async function enviarSenhaTemporaria(email: string, nome: string, senha: string) {
  return sendOrThrow({
    to: email,
    subject: "Sua senha temporária — Portal Costa Júnior",
    html: htmlSenha(nome, senha, "boas-vindas"),
  });
}

export async function enviarSenhaReset(email: string, nome: string, senha: string) {
  return sendOrThrow({
    to: email,
    subject: "Recuperação de senha — Portal Costa Júnior",
    html: htmlSenha(nome, senha, "reset"),
  });
}
