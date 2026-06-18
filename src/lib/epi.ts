import { enviarEmailSimples } from "./mailer";
import { enviarTelegram } from "./telegram";

// ════════════════════════════════════════════════════════════════════════
// Ficha de EPI — catálogo fixo + alertas de vencimento.
// A ficha SEMPRE sai completa, com todos os EPIs necessários (PGR da CJR).
// ════════════════════════════════════════════════════════════════════════

// Ordem e itens conforme o documento padrão da Costa Júnior
// ("Controle de Entrega de Equipamento de Proteção Individual E.P.I.").
export const EPI_CATALOGO = [
  "Máscara respiratória",
  "Protetor auricular",
  "Óculos de proteção",
  "Protetor solar",
  "Botina",
  "Calça",
  "Camiseta",
  "Luva pigmentada",
  "Luva de raspa",
  "Luva de borracha",
  "Luva de proteção mecânica",
  "Luva de proteção química",
  "Capacete",
];

const SITE = import.meta.env.SITE_BASE_URL || "https://costajr.com.br";
// Alertas de EPI vão para o RH e a Engenharia.
export const EPI_ALERT_EMAIL = import.meta.env.EPI_ALERT_EMAIL || "rh@costajr.com.br, engenharia@costajr.com.br";

const fmt = (d: string) => (d ? d.split("-").reverse().join("/") : "—");
function diasAte(validade: string): number {
  const v = new Date(validade + "T00:00:00Z").getTime();
  const h = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").getTime();
  return Math.round((v - h) / 86400000);
}

/**
 * Alerta de EPI a vencer: dispara quando faltam 15 dias (ou menos, ainda não
 * avisado) ou já venceu. E-mail para rh@ + engenharia@. Marca aviso_15 p/ não
 * repetir. Chamado pelo cron diário.
 */
export async function enviarAlertasEpi(db: any, opts: { para?: string; dry?: boolean } = {}) {
  const para = opts.para || EPI_ALERT_EMAIL;
  const hoje = new Date().toISOString().slice(0, 10);
  const limite15 = new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10);

  // itens ativos, com validade, que vencem em <=15 dias (inclui vencidos) e ainda não avisados
  const { data } = await db.from("epi_entregas")
    .select("id, epi, ca, data_validade, aviso_15, colaborador_id, rh_colaboradores(nome, status)")
    .eq("status", "ativo").not("data_validade", "is", null)
    .lte("data_validade", limite15).eq("aviso_15", false).limit(2000);

  const itens = (data || [])
    // status "congelado" (jurídico) ou desligado pausa os alertas de EPI
    .filter((d: any) => { const c: any = Array.isArray(d.rh_colaboradores) ? d.rh_colaboradores[0] : d.rh_colaboradores; return !c || (c.status !== "desligado" && c.status !== "congelado"); })
    .map((d: any) => {
      const c: any = d.rh_colaboradores;
      return { ...d, colaborador: (Array.isArray(c) ? c[0]?.nome : c?.nome) || "—", dias: diasAte(d.data_validade) };
    });
  if (!itens.length) return { total: 0, enviados: 0 };
  if (opts.dry) return { total: itens.length, dry: true, destino: para };

  const linhas = itens.map((i: any) => `<tr>
    <td style="padding:7px 10px;border-bottom:1px solid #eee"><strong>${i.colaborador}</strong></td>
    <td style="padding:7px 10px;border-bottom:1px solid #eee">${i.epi}${i.ca ? ` <span style="color:#9CA3AF">CA ${i.ca}</span>` : ""}</td>
    <td style="padding:7px 10px;border-bottom:1px solid #eee;color:${i.dias < 0 ? "#B91C1C" : "#B45309"};font-weight:700">${i.dias < 0 ? `Vencido há ${Math.abs(i.dias)} dia(s)` : `Vence em ${i.dias} dia(s)`} (${fmt(i.data_validade)})</td>
  </tr>`).join("");
  const html = `<div style="font-family:Arial,sans-serif;color:#2D2F36;max-width:720px">
    <h2 style="color:#C41E3A;margin-bottom:4px">🦺 EPIs a vencer — ${itens.length}</h2>
    <p style="color:#5B5F6B">Os EPIs abaixo estão a 15 dias (ou menos) do vencimento. Providencie a reposição e gere a nova ficha no portal.</p>
    <table style="border-collapse:collapse;width:100%;font-size:14px">
      <thead><tr style="background:#F4F6F9"><th style="text-align:left;padding:8px 10px">Colaborador</th><th style="text-align:left;padding:8px 10px">EPI</th><th style="text-align:left;padding:8px 10px">Vencimento</th></tr></thead>
      <tbody>${linhas}</tbody></table>
    <p style="margin-top:20px"><a href="${SITE}/admin/rh" style="background:#C41E3A;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:700">Abrir o RH no portal</a></p>
    <p style="color:#9CA3AF;font-size:12px;margin-top:24px">Aviso automático — Costa Júnior Engenharia.</p>
  </div>`;

  let enviados = 0;
  for (const to of String(para).split(",").map((s: string) => s.trim()).filter(Boolean)) {
    try { await enviarEmailSimples({ to, subject: `🦺 EPIs a vencer: ${itens.length} item(ns)`, html }); enviados++; } catch { /* ignore */ }
  }
  enviarTelegram(`🦺 <b>EPIs a vencer</b>\n${itens.length} item(ns) próximos do vencimento.\nVeja em costajr.com.br/admin/rh`, { canal: "ADM" }).catch(() => {});
  if (enviados > 0) {
    for (const i of itens) await db.from("epi_entregas").update({ aviso_15: true }).eq("id", i.id);
  }
  return { total: itens.length, enviados };
}
