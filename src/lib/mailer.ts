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

export async function enviarEmailCupomRenovacao(args: {
  clienteEmail: string;
  clienteNome: string;
  codigoCupom: string;
  valorCashback: number;
  descontoPct: number;
  diasParaVencer: number;
}) {
  const valorFmt = `R$ ${args.valorCashback.toFixed(2).replace(".", ",")}`;
  return sendOrThrow({
    to: args.clienteEmail,
    subject: `🎁 Seu cupom de renovação chegou — ${valorFmt} de desconto`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#fff">
        <img src="${SITE}/logo-cjr.png" alt="Costa Júnior" style="height:42px;margin-bottom:24px">
        <h2 style="color:#2D2F36;margin:0 0 8px">Olá, ${args.clienteNome}!</h2>
        <p style="color:#5B5F6B;margin:0 0 20px">Seu plano vence em <strong>${args.diasParaVencer} dias</strong>. Como você acumulou cashback de indicações, geramos automaticamente um cupom de desconto para a renovação:</p>
        <div style="background:#FEF2F2;border:2px dashed #C41E3A;border-radius:10px;padding:22px;text-align:center;margin-bottom:20px">
          <div style="font-size:10.5px;color:#5B5F6B;letter-spacing:2px;text-transform:uppercase;font-weight:700">Seu cupom de renovação</div>
          <div style="font-family:'Montserrat',Arial,sans-serif;font-size:30px;font-weight:700;color:#C41E3A;letter-spacing:3px;margin-top:10px;user-select:all">${args.codigoCupom}</div>
          <div style="font-size:13px;color:#5B5F6B;margin-top:8px">${args.descontoPct.toFixed(2).replace(".", ",")}% de desconto · equivalente a ${valorFmt}</div>
        </div>
        <p style="color:#5B5F6B;margin:0 0 18px;font-size:14px">Quando for renovar seu plano, <strong>digite esse código no campo "Cupom de desconto"</strong>. O abatimento é aplicado automaticamente.</p>
        <a href="${SITE}/manutencao/cliente/dashboard" style="display:inline-block;background:#C41E3A;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:700;font-size:14px">Acessar o painel</a>
        <p style="color:#9CA3AF;font-size:11.5px;margin-top:28px">Cupom válido por 90 dias e de uso único. Costa Júnior — Engenharia e Construções Ltda</p>
      </div>
    `,
  });
}

export async function enviarBoasVindasRepresentante(args: {
  email: string;
  nome: string;
  codigos: string[];
  senhaInicial: string;
  regrasPorPlano: Array<{ label: string; meses: number; desconto_pct: number; duracao_desconto_meses: number; comissao_pct: number }>;
}) {
  const { email, nome, codigos, senhaInicial, regrasPorPlano } = args;
  const cupomBlocos = codigos
    .map(
      (c) => `
      <div style="background:#FEF2F2;border:2px dashed #C41E3A;border-radius:10px;padding:18px;text-align:center;margin-bottom:10px">
        <div style="font-size:10.5px;color:#5B5F6B;letter-spacing:2px;text-transform:uppercase;font-weight:700">Seu cupom</div>
        <div style="font-family:'Montserrat',Arial,sans-serif;font-size:30px;font-weight:700;color:#C41E3A;letter-spacing:3px;margin-top:6px;user-select:all">${c}</div>
        <div style="font-size:12px;color:#5B5F6B;margin-top:8px">
          Link direto: <a href="${SITE}/manutencao/contratar?cupom=${c}" style="color:#C41E3A;word-break:break-all">${SITE.replace(/^https?:\/\//, "")}/manutencao/contratar?cupom=${c}</a>
        </div>
      </div>`,
    )
    .join("");

  const tabelaRegras = `
    <table style="width:100%;border-collapse:collapse;font-size:13px;background:#F9FAFB;border-radius:8px;overflow:hidden;margin:8px 0 22px">
      <thead>
        <tr style="background:#E5E7EB;color:#2D2F36">
          <th style="text-align:left;padding:8px 10px">Plano</th>
          <th style="text-align:left;padding:8px 10px">Desconto cliente</th>
          <th style="text-align:left;padding:8px 10px">Sua comissão</th>
        </tr>
      </thead>
      <tbody>
        ${regrasPorPlano
          .map(
            (r) => `
          <tr style="border-bottom:1px solid #E5E7EB">
            <td style="padding:8px 10px"><strong>${r.label}</strong> (${r.meses}m)</td>
            <td style="padding:8px 10px">${r.desconto_pct === 0 ? "<em>sem desconto</em>" : `${r.desconto_pct}% × ${r.duracao_desconto_meses} ${r.duracao_desconto_meses === 1 ? "mês" : "meses"}`}</td>
            <td style="padding:8px 10px"><strong style="color:#166534">${r.comissao_pct}%</strong></td>
          </tr>`,
          )
          .join("")}
      </tbody>
    </table>
  `;

  return sendOrThrow({
    to: email,
    subject: "🎉 Cadastro aprovado — Costa Júnior Indique e Ganhe",
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;background:#fff">
        <div style="background:linear-gradient(135deg,#166534 0%,#15803D 100%);color:#FFF;padding:28px 28px;border-radius:12px;margin-bottom:28px;text-align:center">
          <h1 style="margin:0 0 6px;font-size:24px">Bem-vindo, ${nome.split(" ")[0]}! 🎉</h1>
          <p style="margin:0;color:#BBF7D0;font-size:14.5px">Seu cadastro no programa Indique e Ganhe foi APROVADO</p>
        </div>

        <p style="color:#2D2F36;font-size:15.5px;line-height:1.6;margin:0 0 18px">
          Que bom ter você como representante da Costa Júnior! A partir de agora você já pode começar a divulgar e ganhar comissão por cada cliente que fechar plano com seu cupom.
        </p>

        <h3 style="color:#2D2F36;margin:28px 0 8px;font-size:16px">📣 ${codigos.length > 1 ? "Seus cupons" : "Seu cupom"}</h3>
        ${cupomBlocos}

        <h3 style="color:#2D2F36;margin:28px 0 8px;font-size:16px">💰 Quanto você ganha por venda</h3>
        <p style="color:#5B5F6B;font-size:13.5px;margin:0 0 6px">A comissão muda conforme o plano que o cliente escolhe (você divulga um código só):</p>
        ${tabelaRegras}

        <h3 style="color:#2D2F36;margin:28px 0 8px;font-size:16px">🔐 Acesso ao Portal do Representante</h3>
        <p style="color:#5B5F6B;font-size:14px;line-height:1.6;margin:0 0 10px">
          Você tem agora um portal pra acompanhar suas vendas, ver o saldo de comissão acumulado, baixar materiais de divulgação e cadastrar sua chave PIX (pros repasses).
        </p>
        <div style="background:#F4F6F9;border-radius:8px;padding:18px 22px;margin:10px 0 14px">
          <div style="font-size:13px;color:#5B5F6B;margin-bottom:6px">Seu login</div>
          <div style="font-size:15px;color:#2D2F36;margin-bottom:14px"><strong>${email}</strong></div>
          <div style="font-size:13px;color:#5B5F6B;margin-bottom:6px">Senha temporária</div>
          <div style="font-family:'Montserrat',Arial,sans-serif;font-size:22px;font-weight:700;color:#C41E3A;letter-spacing:2px;user-select:all">${senhaInicial}</div>
          <p style="font-size:12px;color:#9CA3AF;margin:10px 0 0">Ao entrar pela primeira vez, troque a senha por uma de sua preferência.</p>
        </div>

        <a href="${SITE}/manutencao/representante/login" style="display:inline-block;background:#C41E3A;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:700;font-size:15px;margin-bottom:18px">
          Acessar o Portal →
        </a>

        <h3 style="color:#2D2F36;margin:28px 0 8px;font-size:16px">🚀 Próximos passos</h3>
        <ol style="color:#5B5F6B;font-size:14px;line-height:1.7;padding-left:22px;margin:0">
          <li>Acesse o portal e cadastre sua <strong>chave PIX</strong> (na aba "Meu Perfil")</li>
          <li>Veja os <strong>materiais de treinamento</strong> e o script pronto pra WhatsApp</li>
          <li>Compartilhe seu cupom com sua rede — o link direto já leva o cliente pra contratação com o código aplicado</li>
        </ol>

        <p style="color:#5B5F6B;font-size:14px;line-height:1.6;margin:28px 0 0">
          Qualquer dúvida, chame a gente: <a href="https://wa.me/551123696462" style="color:#C41E3A;font-weight:600">(11) 2369-6462</a>
        </p>

        <p style="color:#9CA3AF;font-size:11px;text-align:center;margin-top:32px;padding-top:16px;border-top:1px solid #E5E7EB">
          Costa Júnior Engenharia e Construções Ltda · CNPJ 07.132.942/0001-72
        </p>
      </div>
    `,
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
