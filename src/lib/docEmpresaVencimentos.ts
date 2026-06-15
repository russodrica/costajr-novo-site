import { enviarEmailSimples } from "./mailer";
import { enviarTelegram } from "./telegram";

// Alertas de vencimento de Documentos da Empresa (certidões, seguros, CRLV,
// alvará, balanços...). Marcos: 30, 15 e 7 dias antes + no dia do vencimento.
// Enviado para o financeiro/jurídico (e-mail) + grupo Telegram administrativo.

const SITE = import.meta.env.SITE_BASE_URL || "https://costajr.com.br";
export const DOC_EMPRESA_ALERT_EMAIL =
  import.meta.env.DOC_EMPRESA_ALERT_EMAIL || "adriana@costajr.com.br, financeiro@costajr.com.br";
const MARCOS = [30, 15, 7, 0]; // dias antes do vencimento (0 = vence hoje)

const fmt = (d: string) => d.split("-").reverse().join("/");
function diasAte(validade: string): number {
  const v = new Date(validade + "T00:00:00Z").getTime();
  const h = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").getTime();
  return Math.round((v - h) / 86400000);
}

type Doc = { id: string; nome: string; categoria: string; validade: string; dias: number };

async function coletar(db: any): Promise<Doc[]> {
  const limite = new Date(Date.now() + 32 * 86400000).toISOString().slice(0, 10);
  const { data } = await db
    .from("doc_empresa")
    .select("id, nome, categoria, validade, validade_na, arquivado")
    .not("validade", "is", null)
    .lte("validade", limite)
    .order("validade", { ascending: true })
    .limit(3000);
  // Não cobra documentos marcados "não aplicável" nem arquivados (defasados).
  return (data || [])
    .filter((d: any) => !d.validade_na && !d.arquivado)
    .map((d: any) => ({ id: d.id, nome: d.nome, categoria: d.categoria || "—", validade: d.validade, dias: diasAte(d.validade) }));
}

function tabela(titulo: string, lista: Doc[], cor: string): string {
  if (!lista.length) return "";
  const linhas = lista
    .map(
      (d) => `<tr>
    <td style="padding:6px 10px;border-bottom:1px solid #eee"><strong>${d.nome}</strong></td>
    <td style="padding:6px 10px;border-bottom:1px solid #eee;color:#9CA3AF;font-size:12px">${d.categoria}</td>
    <td style="padding:6px 10px;border-bottom:1px solid #eee">${fmt(d.validade)}</td>
  </tr>`,
    )
    .join("");
  return `<h3 style="color:${cor};margin:18px 0 6px">${titulo} (${lista.length})</h3>
    <table style="border-collapse:collapse;width:100%;font-size:14px">
      <thead><tr style="background:#F4F6F9"><th style="text-align:left;padding:8px 10px">Documento</th><th style="text-align:left;padding:8px 10px">Categoria</th><th style="text-align:left;padding:8px 10px">Vence em</th></tr></thead>
      <tbody>${linhas}</tbody></table>`;
}

/**
 * Envia o digest de vencimentos de Documentos da Empresa.
 * modo "marcos": só documentos exatamente a 30/15/7 dias ou no dia (cron diário — evita spam).
 * modo "completo": todos os vencidos + vencendo em 30 dias (botão "enviar agora").
 */
export async function enviarDigestVencimentosDocEmpresa(
  db: any,
  opts: { modo?: "marcos" | "completo"; para?: string; dry?: boolean } = {},
) {
  const modo = opts.modo || "marcos";
  const para = opts.para || DOC_EMPRESA_ALERT_EMAIL;
  const docs = await coletar(db);

  const selecionados = modo === "marcos" ? docs.filter((d) => MARCOS.includes(d.dias)) : docs.filter((d) => d.dias <= 30);
  if (!selecionados.length) return { total: 0, enviados: 0 };
  if (opts.dry) return { total: selecionados.length, enviados: 0, dry: true, destino: para };

  const vencidos = selecionados.filter((d) => d.dias < 0);
  const hoje = selecionados.filter((d) => d.dias === 0);
  const em7 = selecionados.filter((d) => d.dias > 0 && d.dias <= 7);
  const em15 = selecionados.filter((d) => d.dias > 7 && d.dias <= 15);
  const em30 = selecionados.filter((d) => d.dias > 15 && d.dias <= 30);

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;padding:24px">
      <h2 style="color:#2D2F36">📑 Documentos da Empresa — vencimentos</h2>
      <p style="color:#5B5F6B">Certidões, seguros, alvará e demais documentos institucionais perto de vencer. Renove a tempo para manter a empresa regular.</p>
      ${tabela("⛔ VENCIDOS", vencidos, "#B91C1C")}
      ${tabela("Vencem HOJE", hoje, "#B91C1C")}
      ${tabela("Vencem em até 7 dias", em7, "#DC2626")}
      ${tabela("Vencem em até 15 dias", em15, "#D97706")}
      ${tabela("Vencem em até 30 dias", em30, "#D97706")}
      <p style="margin-top:20px"><a href="${SITE}/admin/doc-empresa" style="background:#C41E3A;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:700">Abrir Documentos da Empresa</a></p>
      <p style="color:#9CA3AF;font-size:12px;margin-top:24px">Aviso automático — Costa Júnior Engenharia. Alertas em 30, 15 e 7 dias e no dia do vencimento.</p>
    </div>`;

  let enviados = 0,
    falhas = 0;
  for (const to of String(para).split(",").map((s: string) => s.trim()).filter(Boolean)) {
    try {
      await enviarEmailSimples({ to, subject: `📑 Empresa: ${selecionados.length} documento(s) a vencer/vencido(s)`, html });
      enviados++;
    } catch {
      falhas++;
    }
  }
  enviarTelegram(
    `📑 <b>Documentos da Empresa — a vencer</b>\n${selecionados.length} documento(s) vencendo ou vencidos.\nVeja em ${SITE}/admin/doc-empresa`,
    { canal: "ADM" },
  ).catch(() => {});
  return { total: selecionados.length, enviados, falhas };
}
