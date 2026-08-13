import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/supabase";
import { jsonOk, jsonErr } from "../../../lib/auth";
import { clientIp, rateLimit } from "../../../lib/ratelimit";
import { enviarEmailSimples } from "../../../lib/mailer";
import { enviarTelegram, escTg, telegramConfigurado } from "../../../lib/telegram";
import { numeroBr, faixaTexto } from "../../../lib/investidores";

export const prerender = false;

const AVISAR = "adm@costajr.com.br";
const soDigitos = (s: string) => String(s || "").replace(/\D/g, "");

// POST /api/publico/procuro-imovel — PÚBLICO, sem login.
//
// Quem procura imóvel NÃO ganha tabela nova: vira um card na aba "Busca de
// Imóveis" que já existe (negocios_imoveis com tipo='busca'). Assim o pedido
// nasce no mesmo lugar onde a equipe já trabalha, com interessados, anexos e
// histórico — em vez de virar uma caixa de entrada paralela.
export const POST: APIRoute = async ({ request }) => {
  try {
    const ip = clientIp(request);
    if (!(await rateLimit(`procuro:${ip}`, 5, 3600))) {
      return jsonErr(429, "Muitos envios em pouco tempo. Tente novamente daqui a pouco.");
    }

    const b = await request.json().catch(() => null);
    if (!b) return jsonErr(400, "Não recebi os dados do formulário.");

    const nome = String(b.nome ?? "").trim();
    const telefone = String(b.telefone ?? "").trim();
    const email = String(b.email ?? "").trim();
    const procuro = String(b.procuro ?? "").trim();
    const cidade = String(b.cidade ?? "").trim();

    if (nome.length < 5) return jsonErr(400, "Informe seu nome completo.");
    if (soDigitos(telefone).length < 10) return jsonErr(400, "Informe um telefone com DDD.");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonErr(400, "E-mail inválido.");
    if (procuro.length < 15) return jsonErr(400, "Descreva com um pouco mais de detalhe o que você procura.");
    if (!cidade) return jsonErr(400, "Informe a cidade ou região onde procura.");
    if (b.aceite_lgpd !== true && b.aceite_lgpd !== "true" && b.aceite_lgpd !== "on") {
      return jsonErr(400, "É preciso concordar com o uso dos seus dados para continuar.");
    }

    const min = numeroBr(b.valor_min);
    const max = numeroBr(b.valor_max);
    if (min && max && min > max) return jsonErr(400, "O valor mínimo ficou maior que o máximo — confira a faixa.");

    const contato = [telefone, email].filter(Boolean).join(" · ");
    const db = supabaseAdmin();
    const { data, error } = await db.from("negocios_imoveis").insert({
      tipo: "busca",
      titulo: `Busca — ${nome}`,
      status: "procurando",
      ativo: true,
      cidade,
      uf: String(b.uf ?? "").trim().toUpperCase().slice(0, 2) || null,
      cliente_nome: nome,
      cliente_contato: contato,
      perfil_procurado: procuro,
      faixa_valor_min: min,
      faixa_valor_max: max,
      origem: "site CR",
      observacoes: String(b.observacoes ?? "").trim() || null,
    }).select("id").single();

    if (error) {
      console.error("[procuro-imovel] insert falhou:", error.code, error.message, error.details);
      return jsonErr(400, "Não deu para registrar agora. Tente de novo em instantes.");
    }

    const resumo = [
      `Cliente: ${nome}`,
      `Contato: ${contato}`,
      `Onde: ${[cidade, b.uf].filter(Boolean).join("/")}`,
      `Faixa: ${faixaTexto(min, max)}`,
      `Procura: ${procuro}`,
    ];

    try {
      await enviarEmailSimples({
        to: AVISAR,
        subject: `Nova busca de imóvel — ${nome}`,
        html: `<div style="font-family:Arial,sans-serif;color:#5C5563">
          <h2 style="color:#A8842A;margin:0 0 12px">Nova busca de imóvel</h2>
          <p>${resumo.map((l) => String(l).replace(/</g, "&lt;")).join("<br>")}</p>
          <p><a href="https://www.costajr.com.br/admin/negocios/buscas" style="color:#A8842A">Ver em Novos Negócios &rsaquo; Busca de Imóveis</a></p>
        </div>`,
      });
    } catch { /* aviso é secundário */ }

    try {
      if (telegramConfigurado()) {
        await enviarTelegram(
          `🔎 <b>Nova busca de imóvel</b>\n\n${resumo.map((l) => escTg(l)).join("\n")}\n\n<i>Novos Negócios › Busca de Imóveis</i>`,
          { canal: "ATIVOS" },
        );
      }
    } catch { /* aviso é secundário */ }

    return jsonOk({ ok: true, id: data.id }, 201);
  } catch {
    return jsonErr(500, "Erro inesperado. Tente novamente.");
  }
};
