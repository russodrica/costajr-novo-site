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
 * Automação completa (commit 2026-05-20):
 * 1) Cria registro em manut_representantes (ativo=true)
 * 2) Gera 3 cupons automaticamente (TRIM 4%, SEM 7%, ANUAL 10%)
 * 3) Envia email pra comercial@costajr.com.br informando o novo cadastro + códigos
 * 4) Envia email pro novo representante com seus 3 códigos + instruções
 *
 * Se quiser desativar/banir um representante, basta marcar ativo=false em
 * /admin/representantes (os cupons vinculados também ficam inutilizáveis).
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

    // ─── 1. Cria (ou recupera) representante ──────────────────────────
    const { data: existente } = await db
      .from("manut_representantes")
      .select("id, nome, ativo")
      .ilike("email", emailNorm)
      .maybeSingle();

    let representanteId: string;
    let isNovo = false;

    if (existente) {
      representanteId = existente.id;
      // Garante que está ativo se já existia
      if (!existente.ativo) {
        await db
          .from("manut_representantes")
          .update({ ativo: true, updated_at: new Date().toISOString() })
          .eq("id", representanteId);
      }
    } else {
      const { data: novo, error } = await db
        .from("manut_representantes")
        .insert({
          nome: nome.trim(),
          email: emailNorm,
          telefone: telefone.trim(),
          saldo_acumulado: 0,
          ativo: true,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      representanteId = novo.id;
      isNovo = true;
    }

    // ─── 2. Gera código base único (slug do nome + 4 chars random) ────
    const slug = nome
      .toUpperCase()
      .replace(/[ÀÁÂÃÄÅ]/g, "A")
      .replace(/[ÉÈÊË]/g, "E")
      .replace(/[ÍÌÎÏ]/g, "I")
      .replace(/[ÓÒÔÕÖ]/g, "O")
      .replace(/[ÚÙÛÜ]/g, "U")
      .replace(/[Ç]/g, "C")
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 8) || "REP";
    const random = Math.random().toString(36).slice(2, 6).toUpperCase();
    const codigoBase = `${slug}${random}`;

    // ─── 3. Cria 3 cupons (TRIM, SEM, ANUAL) — só se for cadastro novo
    const cuponsCriados: { plano: string; codigo: string; desconto: number; duracao: number; comissao: number }[] = [];

    if (isNovo) {
      const variantes = [
        { sufixo: "TRIM",  desconto_pct: 0,  duracao: 1,  cashback_pct: 4,  label: "Trimestral (3 meses)" },
        { sufixo: "SEM",   desconto_pct: 20, duracao: 1,  cashback_pct: 7,  label: "Semestral (6 meses)" },
        { sufixo: "ANUAL", desconto_pct: 20, duracao: 2,  cashback_pct: 10, label: "Anual (12 meses)" },
      ];

      for (const v of variantes) {
        const codigo = `${codigoBase}-${v.sufixo}`;
        const { error } = await db.from("manut_cupons").insert({
          codigo,
          descricao: `Indicação de ${nome} — válido para plano ${v.label}`,
          desconto_percentual: v.desconto_pct,
          duracao_meses: v.duracao,
          tipo: "representante",
          representante_id: representanteId,
          cashback_pct: v.cashback_pct,
          ativo: true,
        });
        if (!error) {
          cuponsCriados.push({
            plano: v.label,
            codigo,
            desconto: v.desconto_pct,
            duracao: v.duracao,
            comissao: v.cashback_pct,
          });
        } else {
          console.warn("[representante-interessado] falha ao criar cupom", codigo, error.message);
        }
      }
    }

    // ─── 4. Email pra Adriana / comercial ─────────────────────────────
    const cuponsHtml = cuponsCriados.length > 0
      ? cuponsCriados.map(c => `
          <tr>
            <td style="padding:8px 12px;border:1px solid #E5E7EB"><strong>${c.plano}</strong></td>
            <td style="padding:8px 12px;border:1px solid #E5E7EB;font-family:monospace;color:#C41E3A"><strong>${c.codigo}</strong></td>
            <td style="padding:8px 12px;border:1px solid #E5E7EB">${c.desconto > 0 ? `${c.desconto}% × ${c.duracao} mês(es)` : "Sem desconto"}</td>
            <td style="padding:8px 12px;border:1px solid #E5E7EB">${c.comissao}%</td>
          </tr>`).join("")
      : "<tr><td colspan='4' style='padding:8px;color:#9CA3AF'>Representante já existia — cupons não foram recriados.</td></tr>";

    const htmlAdmin = `
      <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:32px 24px;background:#fff">
        <div style="border-left:4px solid #C41E3A;padding-left:16px;margin-bottom:24px">
          <h2 style="color:#2D2F36;margin:0 0 4px">🤝 ${isNovo ? "Novo representante cadastrado" : "Representante reativado"}</h2>
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

        <h3 style="color:#2D2F36;margin:24px 0 10px;font-size:16px">Cupons gerados automaticamente</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13.5px">
          <thead>
            <tr style="background:#1F2126;color:#FFF">
              <th style="padding:10px 12px;text-align:left">Plano</th>
              <th style="padding:10px 12px;text-align:left">Código</th>
              <th style="padding:10px 12px;text-align:left">Desconto cliente</th>
              <th style="padding:10px 12px;text-align:left">Comissão</th>
            </tr>
          </thead>
          <tbody>${cuponsHtml}</tbody>
        </table>

        <div style="margin-top:24px;padding:14px 18px;background:#F0FDF4;border:1px solid #BBF7D0;border-radius:8px">
          <p style="margin:0;color:#166534;font-size:14px">
            ✅ <strong>Representante e cupons já criados no admin.</strong> Acesse
            <a href="https://www.costajr.com.br/admin/representantes" style="color:#166534;font-weight:700">/admin/representantes</a>
            pra ver o cadastro completo. Os 3 códigos acima já estão prontos pra divulgação.
          </p>
        </div>

        <p style="color:#9CA3AF;font-size:12px;margin-top:24px;text-align:center">
          Costa Júnior — Engenharia e Construções Ltda · costajr.com.br
        </p>
      </div>
    `;

    // ─── 5. Email pro representante novo (boas-vindas + códigos) ──────
    const cuponsParaRepHtml = cuponsCriados.map(c => `
      <div style="background:${c.duracao > 1 || (c.desconto === 20 && c.duracao === 2) ? "#FEF3C7" : "#F4F6F9"};border-left:4px solid #C41E3A;padding:14px 18px;margin-bottom:10px;border-radius:6px">
        <p style="margin:0 0 4px;font-weight:700;color:#2D2F36;font-size:13px">${c.plano} ${c.comissao === 10 ? "⭐ MAIS LUCRATIVO" : ""}</p>
        <p style="margin:0;font-size:12px;color:#5B5F6B">Cliente ganha: ${c.desconto > 0 ? `${c.desconto}% off ${c.duracao === 1 ? "no 1º mês" : `nos ${c.duracao} primeiros meses`}` : "Preço cheio"}</p>
        <p style="margin:4px 0 0;font-size:12px;color:#5B5F6B">Sua comissão: <strong style="color:#C41E3A">${c.comissao}%</strong> do contrato</p>
        <p style="margin:8px 0 0;font-family:monospace;font-size:18px;font-weight:700;color:#C41E3A;letter-spacing:1px">${c.codigo}</p>
      </div>
    `).join("");

    const htmlRep = `
      <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:32px 24px;background:#fff">
        <div style="background:linear-gradient(135deg,#C41E3A 0%,#7A1421 100%);color:#FFF;padding:32px 28px;border-radius:12px;margin-bottom:28px;text-align:center">
          <h1 style="margin:0 0 8px;font-size:26px">Bem-vindo ao Indique e Ganhe! 🤝</h1>
          <p style="margin:0;color:#FFB3C0;font-size:15px">Você já está cadastrado e seus cupons estão prontos.</p>
        </div>

        <p style="color:#2D2F36;font-size:16px;line-height:1.6;margin:0 0 16px">
          Olá <strong>${nome.split(" ")[0]}</strong>! Recebemos seu cadastro como representante do programa de indicação da Costa Júnior. <strong>Você já pode começar a divulgar.</strong>
        </p>

        <h3 style="color:#2D2F36;margin:24px 0 12px;font-size:16px">🎟️ Seus 3 cupons personalizados</h3>
        <p style="color:#5B5F6B;font-size:14px;margin:0 0 14px">Cada cupom funciona pra um tipo de plano. Compartilhe o que fizer sentido em cada conversa.</p>
        ${cuponsParaRepHtml}

        <h3 style="color:#2D2F36;margin:32px 0 12px;font-size:16px">📋 Como começar (3 passos)</h3>
        <ol style="color:#5B5F6B;font-size:14px;line-height:1.7;padding-left:20px">
          <li><strong>Identifique lojistas/comércios em SP</strong> que precisam de manutenção predial — restaurantes, franquias, varejo, lojas pequenas.</li>
          <li><strong>Compartilhe o cupom correspondente</strong> ao plano que faz sentido (anual é o que dá mais comissão pra você).</li>
          <li><strong>Quando o contrato fechar</strong>, sua comissão é creditada automaticamente no painel. Saques PIX toda quarta-feira.</li>
        </ol>

        <div style="background:#F4F6F9;padding:16px 20px;border-radius:8px;margin:24px 0">
          <p style="margin:0 0 8px;font-weight:700;color:#2D2F36;font-size:14px">💡 Dica de ouro</p>
          <p style="margin:0;color:#5B5F6B;font-size:13.5px;line-height:1.6">
            Foque em <strong>plano anual</strong> — você ganha <strong>10%</strong> (vs 4% no trimestral). Em uma loja média anual de R$ 3.420, você recebe R$ 342. Em loja grande (R$ 7.410 anual), R$ 741.
          </p>
        </div>

        <div style="text-align:center;margin:32px 0">
          <a href="https://www.costajr.com.br/manutencao" style="display:inline-block;background:#C41E3A;color:#FFF;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">Ver site da Costa Júnior →</a>
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

    // Envia ambos os emails (não bloqueia retorno se um falhar)
    await Promise.allSettled([
      resend.emails.send({
        from: `Costa Júnior <${FROM}>`,
        to: "comercial@costajr.com.br",
        replyTo: email,
        subject: `[Indique e Ganhe] ${isNovo ? "✅ Novo" : "Reativado"}: ${nome} (${cuponsCriados.length} cupons gerados)`,
        html: htmlAdmin,
      }),
      resend.emails.send({
        from: `Costa Júnior <${FROM}>`,
        to: email,
        replyTo: "comercial@costajr.com.br",
        subject: "🤝 Bem-vindo ao Indique e Ganhe — seus cupons já estão prontos",
        html: htmlRep,
      }),
    ]);

    return jsonOk({ ok: true, cuponsCriados: cuponsCriados.length, representanteId });
  } catch (e: any) {
    console.error("[representante-interessado] erro:", e);
    return jsonErr(500, e.message || "Erro ao processar");
  }
};
