import type { APIRoute } from "astro";
import { Resend } from "resend";
import { jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";
import { listarRegrasIndicacao } from "~/lib/manut/indicacao-regras";

export const prerender = false;

const resend = new Resend(import.meta.env.RESEND_API_KEY);
const FROM = import.meta.env.EMAIL_FROM || "onboarding@resend.dev";

/**
 * Recebe cadastro de representante pelo formulário público /indique-e-ganha.
 *
 * Fluxo (com aprovação manual da Adriana):
 * 1) Cria registro em manut_representantes com ativo=false (PENDENTE)
 * 2) Cria 1 cupom único tipo='representante' (ativo=false). As regras de desconto/comissão
 *    NÃO são fixadas no registro: o sistema decide na hora da contratação consultando
 *    a tabela em ~/lib/manut/indicacao-regras (regras variam por plano: trim/sem/anual).
 * 3) Email pra comercial@ com info + link pra aprovar
 * 4) Email confirmando recebimento pro novo representante (SEM citar o cupom — ele só
 *    recebe os códigos depois que Adriana aprovar e ela mesma manda o email comercial)
 *
 * Pra ATIVAR: Adriana vai em /admin/representantes → liga toggle "ativo". Quando ativa
 * o representante, todos os cupons inativos vinculados são ativados juntos.
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

      // ─── 3. Gera código curto: INICIAIS + ANO(2d) + SEQUENCIA(2d)
      // Ex: Marcel Zara em 2026 → "MZ2601" (1º cupom com esse prefixo)
      //     Se outro Marcel Z. se cadastrar → "MZ2602"
      const normalizar = (s: string) => s
        .toUpperCase()
        .replace(/[ÀÁÂÃÄÅ]/g, "A")
        .replace(/[ÉÈÊË]/g, "E")
        .replace(/[ÍÌÎÏ]/g, "I")
        .replace(/[ÓÒÔÕÖ]/g, "O")
        .replace(/[ÚÙÛÜ]/g, "U")
        .replace(/[Ç]/g, "C")
        .replace(/[^A-Z ]/g, "");
      const palavras = normalizar(nome).split(/\s+/).filter(Boolean);
      // Pega 1ª letra das 2 primeiras palavras (ex: "Marcel Zara" → "MZ").
      // Se o nome tem só 1 palavra, repete a letra (ex: "Adriana" → "AA").
      let iniciais = palavras.slice(0, 2).map(p => p[0]).join("");
      if (iniciais.length < 2) iniciais = (iniciais + iniciais).slice(0, 2) || "RP";
      const anoCurto = String(new Date().getFullYear()).slice(-2);
      const prefixo = `${iniciais}${anoCurto}`; // ex: "MZ26"

      // Conta quantos cupons já têm esse prefixo no banco pra calcular próxima sequência
      const { data: existentes } = await db
        .from("manut_cupons")
        .select("codigo")
        .like("codigo", `${prefixo}%`);
      const seq = String((existentes?.length ?? 0) + 1).padStart(2, "0");
      codigoCupom = `${prefixo}${seq}`; // ex: "MZ2601"

      // ─── 4. Cria 1 cupom único tipo='representante' ────────────────
      // As regras de desconto/duração/comissão NÃO são lidas do registro: o sistema
      // resolve dinamicamente em runtime conforme o plano que o cliente escolhe
      // (ver ~/lib/manut/indicacao-regras). Os campos abaixo guardam apenas o caso
      // "anual" como referência histórica/fallback caso o tipo seja alterado.
      // ativo=false → Adriana aprova depois (ativando o representante → propaga pro cupom)
      const { error: errCupom } = await db.from("manut_cupons").insert({
        codigo: codigoCupom,
        descricao: `Indicação de ${nome.trim()} — regras variam por plano (trim/sem/anual)`,
        desconto_percentual: 20, // referência — não é usado pra cupom de representante
        duracao_meses: 2,         // referência — não é usado pra cupom de representante
        tipo: "representante",
        representante_id: representanteId,
        cashback_pct: 10,         // referência — não é usado pra cupom de representante
        ativo: false,             // 👈 Pendente até Adriana aprovar
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
      : `Acesse <a href="https://www.costajr.com.br/admin/representantes" style="color:${corAviso};font-weight:700">/admin/representantes</a> e ATIVE o representante (toggle 'ativo'). Ao ativar, o cupom <strong>${codigoCupom || "(não foi criado)"}</strong> também é ativado automaticamente — não precisa mexer em /admin/cupons.`;

    // Lista das 3 regras dinâmicas (mesmo conjunto pra todo cupom de representante)
    const regras = listarRegrasIndicacao();

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
          <p style="margin:0 0 8px">Este é um cupom <strong>dinâmico</strong>: as regras variam conforme o plano que o cliente escolhe na contratação:</p>
          <table style="width:100%;border-collapse:collapse;font-size:13px;background:#FFF;border-radius:6px;overflow:hidden;margin-top:8px">
            <thead>
              <tr style="background:#FDE68A;color:#7C2D12">
                <th style="text-align:left;padding:6px 10px">Plano</th>
                <th style="text-align:left;padding:6px 10px">Desconto cliente</th>
                <th style="text-align:left;padding:6px 10px">Comissão rep.</th>
              </tr>
            </thead>
            <tbody>
              ${regras.map(r => `
                <tr style="border-bottom:1px solid #FDE68A">
                  <td style="padding:6px 10px"><strong>${r.label}</strong> (${r.meses}m)</td>
                  <td style="padding:6px 10px">${r.desconto_pct === 0 ? "<em>sem desconto</em>" : `${r.desconto_pct}% × ${r.duracao_desconto_meses} ${r.duracao_desconto_meses === 1 ? "mês" : "meses"}`}</td>
                  <td style="padding:6px 10px"><strong>${r.comissao_pct}%</strong></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
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
