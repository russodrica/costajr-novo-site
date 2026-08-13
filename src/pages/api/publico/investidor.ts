import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/supabase";
import { jsonOk, jsonErr } from "../../../lib/auth";
import { clientIp, rateLimit } from "../../../lib/ratelimit";
import { enviarEmailSimples } from "../../../lib/mailer";
import { enviarTelegram, escTg, telegramConfigurado } from "../../../lib/telegram";
import {
  OPERACOES, TIPOS_IMOVEL, PRAZOS, RECURSOS, EXPERIENCIAS,
  filtrarCodigos, umDe, numeroBr, faixaTexto,
  LABEL_OPERACAO, LABEL_TIPO, LABEL_PRAZO,
} from "../../../lib/investidores";

export const prerender = false;

const AVISAR = "adm@costajr.com.br";
const soDigitos = (s: string) => String(s || "").replace(/\D/g, "");

// POST /api/publico/investidor — PÚBLICO, sem login.
// Cadastro de investidor pelo site da CR (crintermediacao.com.br/investidor).
export const POST: APIRoute = async ({ request }) => {
  try {
    const ip = clientIp(request);
    // formulário aberto na internet: trava por IP para não virar porta de spam
    if (!(await rateLimit(`investidor:${ip}`, 5, 3600))) {
      return jsonErr(429, "Muitos envios em pouco tempo. Tente novamente daqui a pouco.");
    }

    const b = await request.json().catch(() => null);
    if (!b) return jsonErr(400, "Não recebi os dados do formulário.");

    const nome = String(b.nome ?? "").trim();
    const email = String(b.email ?? "").trim();
    const telefone = String(b.telefone ?? "").trim();
    if (nome.length < 5) return jsonErr(400, "Informe seu nome completo.");
    if (soDigitos(telefone).length < 10) return jsonErr(400, "Informe um telefone com DDD.");
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonErr(400, "Informe um e-mail válido.");
    if (b.aceite_lgpd !== true && b.aceite_lgpd !== "true" && b.aceite_lgpd !== "on") {
      return jsonErr(400, "É preciso concordar com o uso dos seus dados para continuar.");
    }

    const operacoes = filtrarCodigos(b.operacoes, OPERACOES);
    const tipos = filtrarCodigos(b.tipos_imovel, TIPOS_IMOVEL);
    if (!operacoes.length) return jsonErr(400, "Escolha pelo menos um tipo de operação.");

    const ticket_min = numeroBr(b.ticket_min);
    const ticket_max = numeroBr(b.ticket_max);
    if (ticket_min && ticket_max && ticket_min > ticket_max) {
      return jsonErr(400, "O valor mínimo ficou maior que o máximo — confira a faixa.");
    }

    const db = supabaseAdmin();
    const { data, error } = await db.from("negocios_investidores").insert({
      nome, email, telefone,
      cidade: String(b.cidade ?? "").trim() || null,
      uf: String(b.uf ?? "").trim().toUpperCase().slice(0, 2) || null,
      tipo_pessoa: b.tipo_pessoa === "juridica" ? "juridica" : "fisica",
      empresa: String(b.empresa ?? "").trim() || null,
      operacoes, tipos_imovel: tipos,
      regioes: String(b.regioes ?? "").trim() || null,
      ticket_min, ticket_max,
      prazo: umDe(b.prazo, PRAZOS),
      recursos: umDe(b.recursos, RECURSOS),
      experiencia: umDe(b.experiencia, EXPERIENCIAS),
      observacoes: String(b.observacoes ?? "").trim() || null,
      origem: "site",
      status: "novo",
      aceite_lgpd: true,
      aceite_ip: ip,
      aceite_user_agent: String(request.headers.get("user-agent") || "").slice(0, 300),
    }).select("id").single();

    if (error) {
      console.error("[investidor] insert falhou:", error.code, error.message, error.details);
      return jsonErr(400, "Não deu para registrar agora. Tente de novo em instantes.");
    }

    // ── avisos (nunca derrubam o cadastro se falharem) ──
    const resumo = [
      `Investidor: ${nome}`,
      `Telefone: ${telefone}`,
      `E-mail: ${email}`,
      `Operações: ${operacoes.map((o) => LABEL_OPERACAO[o]).join(", ")}`,
      tipos.length ? `Tipos: ${tipos.map((t) => LABEL_TIPO[t]).join(", ")}` : "",
      `Faixa: ${faixaTexto(ticket_min, ticket_max)}`,
      b.regioes ? `Regiões: ${String(b.regioes).trim()}` : "",
      b.prazo ? `Prazo: ${LABEL_PRAZO[String(b.prazo)] || String(b.prazo)}` : "",
    ].filter(Boolean);

    try {
      await enviarEmailSimples({
        to: AVISAR,
        subject: `Novo investidor — ${nome}`,
        html: `<div style="font-family:Arial,sans-serif;color:#5C5563">
          <h2 style="color:#A8842A;margin:0 0 12px">Novo investidor cadastrado</h2>
          <p>${resumo.map((l) => String(l).replace(/</g, "&lt;")).join("<br>")}</p>
          <p><a href="https://www.costajr.com.br/admin/negocios/investidores" style="color:#A8842A">Ver em Novos Negócios &rsaquo; Investidores</a></p>
        </div>`,
      });
    } catch { /* aviso é secundário */ }

    try {
      if (telegramConfigurado()) {
        // grupo de ATIVOS, como combinado para as autorizações de venda
        await enviarTelegram(
          `💼 <b>Novo investidor</b>\n\n${resumo.map((l) => escTg(l)).join("\n")}\n\n<i>Novos Negócios › Investidores</i>`,
          { canal: "ATIVOS" },
        );
      }
    } catch { /* aviso é secundário */ }

    return jsonOk({ ok: true, id: data.id }, 201);
  } catch {
    return jsonErr(500, "Erro inesperado. Tente novamente.");
  }
};
