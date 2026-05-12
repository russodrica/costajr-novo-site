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

function ADMIN_EMAIL(): string {
  return import.meta.env.ADMIN_NOTIFICATION_EMAIL || "adriana@costajr.com.br";
}

function htmlGenerico(args: {
  titulo: string;
  subtitulo: string;
  destaque?: string;
  linhas: Array<{ rotulo: string; valor: string }>;
  rodape?: string;
  cta?: { url: string; texto: string };
}) {
  const { titulo, subtitulo, destaque, linhas, cta, rodape } = args;
  return `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#fff">
      <img src="${SITE}/logo-cjr.png" alt="Costa Júnior" style="height:42px;margin-bottom:24px">
      <h2 style="color:#2D2F36;margin:0 0 8px">${titulo}</h2>
      <p style="color:#5B5F6B;margin:0 0 20px">${subtitulo}</p>
      ${destaque ? `<div style="background:#FEF2F2;border-left:4px solid #C41E3A;padding:14px 16px;border-radius:6px;margin-bottom:20px;color:#7F1D1D;font-weight:600">${destaque}</div>` : ""}
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:14px">
        ${linhas.map(l => `<tr><td style="padding:8px 0;color:#9CA3AF;width:160px;vertical-align:top">${l.rotulo}</td><td style="padding:8px 0;color:#2D2F36;font-weight:600">${l.valor}</td></tr>`).join("")}
      </table>
      ${cta ? `<a href="${cta.url}" style="display:inline-block;background:#C41E3A;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:700;font-size:14px">${cta.texto}</a>` : ""}
      <p style="color:#9CA3AF;font-size:11.5px;margin-top:28px">${rodape || "Costa Júnior — Engenharia e Construções Ltda"}</p>
    </div>
  `;
}

export async function enviarEmailChamadoAdmin(args: {
  tipoChamado: "extra" | "emergencial";
  clienteNome: string;
  lojaNome: string;
  disciplina: string;
  descricao: string;
  valor: number;
  chamadoId: string;
}) {
  const label = args.tipoChamado === "emergencial" ? "EMERGENCIAL (24h)" : "EXTRA (48h)";
  return sendOrThrow({
    to: ADMIN_EMAIL(),
    subject: `[CJR] Chamado ${label} aberto — ${args.lojaNome}`,
    html: htmlGenerico({
      titulo: `Novo chamado ${label.toLowerCase()}`,
      subtitulo: `O cliente ${args.clienteNome} acabou de abrir um chamado pago com prioridade. O pagamento via Pix está aguardando confirmação.`,
      destaque: args.tipoChamado === "emergencial"
        ? "⚡ Atendimento esperado em 24h úteis."
        : "🛠️ Atendimento esperado em 48h úteis.",
      linhas: [
        { rotulo: "Cliente", valor: args.clienteNome },
        { rotulo: "Loja", valor: args.lojaNome },
        { rotulo: "Disciplina", valor: args.disciplina },
        { rotulo: "Descrição", valor: args.descricao },
        { rotulo: "Valor cobrado", valor: `R$ ${args.valor.toFixed(2).replace(".", ",")}` },
      ],
      cta: { url: `${SITE}/admin/chamados`, texto: "Abrir no painel admin" },
    }),
  });
}

export async function enviarEmailChamadoTecnico(args: {
  tecnicoEmail: string;
  tecnicoNome: string;
  tipoChamado: "extra" | "emergencial";
  lojaNome: string;
  disciplina: string;
  descricao: string;
}) {
  const label = args.tipoChamado === "emergencial" ? "EMERGENCIAL (24h)" : "EXTRA (48h)";
  return sendOrThrow({
    to: args.tecnicoEmail,
    subject: `[CJR] Atribuído chamado ${label} — ${args.lojaNome}`,
    html: htmlGenerico({
      titulo: `Olá ${args.tecnicoNome}, novo chamado para você`,
      subtitulo: `Você foi atribuído a um chamado ${label.toLowerCase()} pago. Confirme atendimento o quanto antes.`,
      linhas: [
        { rotulo: "Loja", valor: args.lojaNome },
        { rotulo: "Disciplina", valor: args.disciplina },
        { rotulo: "Descrição", valor: args.descricao },
      ],
      cta: { url: `${SITE}/manutencao/tecnico/chamados`, texto: "Ver no painel técnico" },
    }),
  });
}

export async function enviarEmailVisitaAdicionalAdmin(args: {
  clienteNome: string;
  lojaNome: string;
  dataDesejada: string;
  preventivaId: string;
}) {
  return sendOrThrow({
    to: ADMIN_EMAIL(),
    subject: `[CJR] Visita adicional solicitada — ${args.lojaNome}`,
    html: htmlGenerico({
      titulo: "Visita adicional agendada",
      subtitulo: `${args.clienteNome} agendou uma visita adicional pelo painel.`,
      linhas: [
        { rotulo: "Cliente", valor: args.clienteNome },
        { rotulo: "Loja", valor: args.lojaNome },
        { rotulo: "Data desejada", valor: args.dataDesejada },
      ],
      cta: { url: `${SITE}/admin/preventivas`, texto: "Confirmar técnico" },
    }),
  });
}

export async function enviarEmailSuporteAdmin(args: {
  clienteNome: string;
  email: string;
  assunto: string;
  descricao: string;
  ticketId: string;
}) {
  return sendOrThrow({
    to: ADMIN_EMAIL(),
    subject: `[CJR] Novo ticket de suporte — ${args.assunto}`,
    html: htmlGenerico({
      titulo: "Novo ticket de suporte",
      subtitulo: `${args.clienteNome} (${args.email}) enviou um pedido de suporte.`,
      linhas: [
        { rotulo: "Assunto", valor: args.assunto },
        { rotulo: "Descrição", valor: args.descricao },
      ],
      cta: { url: `${SITE}/admin/suporte`, texto: "Responder no painel" },
    }),
  });
}
