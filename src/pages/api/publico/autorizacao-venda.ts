import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/supabase";
import { jsonOk, jsonErr } from "../../../lib/auth";
import { clientIp, rateLimit } from "../../../lib/ratelimit";
import { enviarEmailSimples } from "../../../lib/mailer";
import { enviarTelegram, escTg, telegramConfigurado } from "../../../lib/telegram";
import {
  montarTermo, TERMO_VERSAO, PRAZO_DIAS, AVISO_DIAS, enderecoLinha, moedaBr, INTERMEDIARIO,
} from "../../../lib/termoVenda";

export const prerender = false;

const AVISAR = "adriana@costajr.com.br";

const CAMPOS = [
  "nome", "nacionalidade", "estado_civil", "profissao", "rg", "cpf",
  "telefone", "email",
  "cep", "endereco", "numero", "complemento", "bairro", "cidade", "uf",
  "imovel_endereco", "imovel_numero", "imovel_bairro", "imovel_cidade", "imovel_uf",
  "imovel_cep", "imovel_matricula", "imovel_descricao",
];

const soDigitos = (s: string) => String(s || "").replace(/\D/g, "");

/** Validação de CPF de verdade — sem isso entra "111.111.111-11" e a autorização
 *  fica sem valor. Só os dígitos verificadores; não consulta a Receita. */
function cpfValido(cpf: string): boolean {
  const c = soDigitos(cpf);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) s += Number(c[i]) * (10 - i);
  let d1 = (s * 10) % 11; if (d1 === 10) d1 = 0;
  if (d1 !== Number(c[9])) return false;
  s = 0;
  for (let i = 0; i < 10; i++) s += Number(c[i]) * (11 - i);
  let d2 = (s * 10) % 11; if (d2 === 10) d2 = 0;
  return d2 === Number(c[10]);
}

// POST /api/publico/autorizacao-venda — PÚBLICO, sem login.
// O proprietário preenche, aceita o termo e vira cadastro em Novos Negócios.
export const POST: APIRoute = async ({ request }) => {
  try {
    const ip = clientIp(request);
    // formulário aberto na internet: trava por IP para não virar porta de spam
    if (!(await rateLimit(`autvenda:${ip}`, 5, 3600))) {
      return jsonErr(429, "Muitos envios em pouco tempo. Tente novamente daqui a pouco.");
    }

    const body = await request.json().catch(() => null);
    if (!body) return jsonErr(400, "Não recebi os dados do formulário.");

    const dados: Record<string, any> = {};
    for (const c of CAMPOS) {
      const v = String(body[c] ?? "").trim();
      dados[c] = v || null;
    }
    if (dados.uf) dados.uf = String(dados.uf).toUpperCase().slice(0, 2);
    if (dados.imovel_uf) dados.imovel_uf = String(dados.imovel_uf).toUpperCase().slice(0, 2);

    // obrigatórios — o mínimo para o termo ter pé e para conseguirmos falar com a pessoa
    if (!dados.nome || dados.nome.length < 5) return jsonErr(400, "Informe o nome completo.");
    if (!dados.telefone || soDigitos(dados.telefone).length < 10) return jsonErr(400, "Informe um telefone com DDD.");
    if (!cpfValido(dados.cpf || "")) return jsonErr(400, "CPF inválido — confira os números.");
    if (!dados.imovel_endereco || !dados.imovel_cidade) return jsonErr(400, "Informe o endereço e a cidade do imóvel.");
    if (dados.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dados.email)) return jsonErr(400, "E-mail inválido.");

    const area = String(body.imovel_area ?? "").replace(/\./g, "").replace(",", ".").trim();
    const valor = String(body.valor_referencia ?? "").replace(/\./g, "").replace(",", ".").trim();
    const imovel_area = area && Number.isFinite(Number(area)) ? Number(area) : null;
    const valor_referencia = valor && Number.isFinite(Number(valor)) ? Number(valor) : null;

    const aceitou = body.aceite === true || body.aceite === "true" || body.aceite === "on";
    if (!aceitou) return jsonErr(400, "É preciso aceitar o termo para concluir.");
    const assinatura = String(body.assinatura_nome || "").trim();
    if (assinatura.length < 5) return jsonErr(400, "Digite seu nome completo no campo de assinatura.");

    const paraTermo = { ...dados, imovel_area, valor_referencia };
    const termo_texto = montarTermo(paraTermo as any);

    const db = supabaseAdmin();
    const { data, error } = await db.from("negocios_proprietarios").insert({
      ...dados, imovel_area, valor_referencia,
      cpf: soDigitos(dados.cpf),
      termo_versao: TERMO_VERSAO, termo_texto,
      aceite_ip: ip, aceite_user_agent: String(request.headers.get("user-agent") || "").slice(0, 300),
      assinatura_nome: assinatura,
      // Prazo INDETERMINADO: a coluna nasceu `not null default 90` e, quando o
      // termo virou "vale até o proprietário pedir o cancelamento", mandar null
      // aqui passou a violar o NOT NULL — e isso derrubava TODO cadastro.
      // Só mandamos o campo quando existe prazo.
      ...(PRAZO_DIAS == null ? {} : { prazo_dias: PRAZO_DIAS }),
      aviso_dias: AVISO_DIAS,
      status: "novo",
    }).select("id, nome").single();
    if (error) {
      // motivo real vai para o log da Vercel; para o proprietário, texto simples
      console.error("[autorizacao-venda] insert falhou:", error.code, error.message, error.details);
      return jsonErr(400, "Não deu para registrar agora. Tente de novo em instantes.");
    }

    // ── avisos (nunca derrubam o cadastro se falharem) ──
    const resumo = [
      `Proprietário: ${dados.nome}`,
      `Telefone: ${dados.telefone}`,
      dados.email ? `E-mail: ${dados.email}` : "",
      `CPF: ${soDigitos(dados.cpf).replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4")}`,
      `Imóvel: ${enderecoLinha(paraTermo as any, "imovel_")}`,
      `Valor de referência: ${moedaBr(valor_referencia)}`,
    ].filter(Boolean);

    try {
      await enviarEmailSimples({
        to: AVISAR,
        subject: `Nova autorização de venda — ${dados.nome}`,
        html: `<div style="font-family:Arial,sans-serif;color:#5B5F6B">
          <h2 style="color:#C41E3A;margin:0 0 12px">Nova autorização de venda assinada</h2>
          <p>${resumo.map((l) => String(l).replace(/</g, "&lt;")).join("<br>")}</p>
          <p style="font-size:13px">Aceite registrado em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} — IP ${ip}.</p>
          <p><a href="https://www.costajr.com.br/admin/negocios/proprietarios" style="color:#C41E3A">Ver em Novos Negócios &rsaquo; Proprietários</a></p>
        </div>`,
      });
    } catch { /* aviso é secundário */ }

    try {
      if (telegramConfigurado()) {
        // grupo de ATIVOS (bot @cjr_ativo_bot) — pedido da Adriana: assim o time
        // inteiro vê a autorização chegar, não só ela
        await enviarTelegram(
          `🏡 <b>Nova autorização de venda</b>\n\n${resumo.map((l) => escTg(l)).join("\n")}\n\n<i>Novos Negócios › Proprietários</i>`,
          { canal: "ATIVOS" },
        );
      }
    } catch { /* aviso é secundário */ }

    return jsonOk({ ok: true, id: data.id, intermediario: INTERMEDIARIO }, 201);
  } catch (e: any) {
    return jsonErr(500, "Erro inesperado. Tente novamente.");
  }
};
