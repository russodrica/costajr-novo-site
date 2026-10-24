import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/supabase";
import { enviarEmailSimples } from "../../../lib/mailer";
import { registrarAcao } from "../../../lib/auditoria";

export const prerender = false;

// Recebe as propostas da vitrine pública (site independente de venda dos itens do depósito)
// e avisa por e-mail. Endpoint público: valida tamanho, limita por IP e escapa o HTML.
const DESTINO = (import.meta.env.VITRINE_EMAIL_DESTINO || "adriana@costajr.com.br").trim();
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "content-type",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS } });

export const OPTIONS: APIRoute = () => new Response(null, { status: 204, headers: CORS });

const recentes = new Map<string, number[]>();
function limitado(ip: string): boolean {
  const agora = Date.now();
  const lista = (recentes.get(ip) || []).filter((t) => agora - t < 10 * 60_000);
  if (lista.length >= 5) return true;
  lista.push(agora);
  recentes.set(ip, lista);
  return false;
}
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as any)[c]);
const txt = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

export const POST: APIRoute = async ({ request }) => {
  try {
    const bruto = await request.text();
    if (bruto.length > 30_000) return json(413, { success: false, message: "Mensagem grande demais." });
    let b: any;
    try { b = JSON.parse(bruto); } catch { return json(400, { success: false, message: "Dados inválidos." }); }
    const ip = String(request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "").split(",")[0].trim() || "?";
    if (limitado(ip)) return json(429, { success: false, message: "Muitas tentativas. Tente de novo em alguns minutos." });
    if (txt(b.site, 50)) return json(200, { success: true }); // honeypot: finge sucesso

    const nome = txt(b.nome, 120), telefone = txt(b.telefone, 40);
    const endereco = txt(b.endereco_entrega, 400);
    if (nome.length < 3 || telefone.replace(/\D/g, "").length < 10 || endereco.length < 10)
      return json(400, { success: false, message: "Confira nome, telefone e endereço." });
    const itens = txt(b.itens_escolhidos, 6000);
    if (itens.length < 3) return json(400, { success: false, message: "Nenhum item escolhido." });

    const dados = {
      nome, telefone,
      email: txt(b.email_contato, 120),
      endereco,
      proposta: txt(b.proposta, 300),
      observacoes: txt(b.observacoes, 1000),
      itens,
      valorReferencia: txt(b.valor_de_referencia, 120),
      enviadoEm: txt(b.enviado_em, 40),
    };
    const L = (k: string, v: string) => `<tr><td style="padding:6px 10px;font-weight:700;vertical-align:top;white-space:nowrap">${k}</td><td style="padding:6px 10px">${esc(v).replace(/\n/g, "<br>")}</td></tr>`;
    const html = `<div style="font-family:Arial,sans-serif;max-width:640px"><h2 style="margin:0 0 12px">Nova proposta — Liquidação de Estoque de Empresa</h2><table style="border-collapse:collapse;width:100%;font-size:14px;border:1px solid #ddd">`
      + L("Nome", dados.nome) + L("Telefone", dados.telefone) + L("E-mail", dados.email || "(não informado)")
      + L("Endereço de entrega", dados.endereco) + L("Proposta", dados.proposta || "(sem proposta de valor)")
      + L("Observações", dados.observacoes || "(nenhuma)") + L("Itens escolhidos", dados.itens)
      + L("Valor de referência", dados.valorReferencia || "—")
      + `</table><p style="color:#666;font-size:12px">Sujeito à conferência de disponibilidade. Se a proposta for aceita, avise o interessado e cote o frete.</p></div>`;
    await enviarEmailSimples({ to: DESTINO, subject: `Nova proposta — ${dados.nome}`, html });

    try {
      await registrarAcao(supabaseAdmin(), { req: request, admin: { email: "vitrine-publica" } as any }, {
        acao: "criar", entidade: "vitrine_proposta", registro_id: null,
        descricao: `Proposta da vitrine: ${dados.nome} (${dados.telefone})`, dados,
      });
    } catch { /* o e-mail já foi; o registro é um extra */ }
    return json(200, { success: true });
  } catch (e: any) {
    return json(500, { success: false, message: "Não foi possível enviar agora." });
  }
};
