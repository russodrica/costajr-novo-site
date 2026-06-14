import { enviarEmailSimples } from "./mailer";

// Alertas de vencimento de documentos de RH (ASO, CNH, Ficha EPI, NRs...).
// Marcos: 30, 15 e 7 dias antes + no dia do vencimento. Enviado para o RH.

const SITE = import.meta.env.SITE_BASE_URL || "https://costajr.com.br";
export const RH_ALERT_EMAIL = import.meta.env.RH_ALERT_EMAIL || "rh@costajr.com.br, adriana@costajr.com.br";
const CRITICOS = new Set(["aso", "cnh"]);
const MARCOS = [30, 15, 7, 0]; // dias antes do vencimento (0 = vence hoje)

const TIPOS: Record<string, string> = {
  contrato: "Contrato", aso: "ASO", ficha_epi: "Ficha EPI", advertencia: "Advertência",
  atestado: "Atestado", certificado: "Certificado", cnh: "CNH", outro: "Documento",
};
const fmt = (d: string) => d.split("-").reverse().join("/");
function diasAte(validade: string): number {
  const v = new Date(validade + "T00:00:00Z").getTime();
  const h = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").getTime();
  return Math.round((v - h) / 86400000);
}

type Doc = { id: string; titulo: string; tipo: string; validade: string; dias: number; colaborador: string };

async function coletar(db: any): Promise<Doc[]> {
  const limite = new Date(Date.now() + 32 * 86400000).toISOString().slice(0, 10);
  const { data } = await db.from("rh_documentos")
    .select("id, titulo, tipo, validade, rh_colaboradores(nome, status, regime, status_juridico)")
    .not("validade", "is", null).lte("validade", limite)
    .order("validade", { ascending: true }).limit(3000);
  // Não alerta documentos de DESLIGADOS (inativos), DIARISTAS (esporádicos) nem
  // de colaboradores com status jurídico CONGELADO (litígio — alertas pausados).
  return (data || [])
    .filter((d: any) => { const c = d.rh_colaboradores; return c && c.status !== "desligado" && c.regime !== "diarista" && c.status_juridico !== "congelado"; })
    .map((d: any) => ({
      id: d.id, titulo: d.titulo, tipo: d.tipo, validade: d.validade,
      dias: diasAte(d.validade), colaborador: d.rh_colaboradores?.nome || "—",
    }));
}

function tabela(titulo: string, lista: Doc[], cor: string): string {
  if (!lista.length) return "";
  const linhas = lista.map((d) => `<tr>
    <td style="padding:6px 10px;border-bottom:1px solid #eee">${CRITICOS.has(d.tipo) ? "🔴 " : ""}<strong>${d.titulo}</strong> <span style="color:#9CA3AF;font-size:12px">${TIPOS[d.tipo] || d.tipo}</span></td>
    <td style="padding:6px 10px;border-bottom:1px solid #eee">${d.colaborador}</td>
    <td style="padding:6px 10px;border-bottom:1px solid #eee">${fmt(d.validade)}</td>
  </tr>`).join("");
  return `<h3 style="color:${cor};margin:18px 0 6px">${titulo} (${lista.length})</h3>
    <table style="border-collapse:collapse;width:100%;font-size:14px">
      <thead><tr style="background:#F4F6F9"><th style="text-align:left;padding:8px 10px">Documento</th><th style="text-align:left;padding:8px 10px">Colaborador</th><th style="text-align:left;padding:8px 10px">Vence em</th></tr></thead>
      <tbody>${linhas}</tbody></table>`;
}

/**
 * Envia o digest de vencimentos para o RH.
 * modo "marcos": só documentos exatamente a 30/15/7 dias ou no dia (para o cron diário — evita spam).
 * modo "completo": todos os vencidos + vencendo em 30 dias (para o botão "enviar agora").
 */
export async function enviarDigestVencimentosRh(db: any, opts: { modo?: "marcos" | "completo"; para?: string; dry?: boolean } = {}) {
  const modo = opts.modo || "marcos";
  const para = opts.para || RH_ALERT_EMAIL;
  const docs = await coletar(db);

  let selecionados: Doc[];
  if (modo === "marcos") {
    selecionados = docs.filter((d) => MARCOS.includes(d.dias));
  } else {
    selecionados = docs.filter((d) => d.dias <= 30); // inclui vencidos (dias<0) e vencendo 30d
  }
  if (!selecionados.length) return { total: 0, enviados: 0 };
  if (opts.dry) return { total: selecionados.length, enviados: 0, dry: true, destino: para };

  const vencidos = selecionados.filter((d) => d.dias < 0);
  const hoje = selecionados.filter((d) => d.dias === 0);
  const em7 = selecionados.filter((d) => d.dias > 0 && d.dias <= 7);
  const em15 = selecionados.filter((d) => d.dias > 7 && d.dias <= 15);
  const em30 = selecionados.filter((d) => d.dias > 15 && d.dias <= 30);

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;padding:24px">
      <h2 style="color:#2D2F36">🚨 Documentos de RH — vencimentos</h2>
      <p style="color:#5B5F6B">Documentos críticos (ASO/CNH) marcados com 🔴. Mantenha-os em dia para o pessoal poder trabalhar no canteiro.</p>
      ${tabela("⛔ VENCIDOS", vencidos, "#B91C1C")}
      ${tabela("Vencem HOJE", hoje, "#B91C1C")}
      ${tabela("Vencem em até 7 dias", em7, "#DC2626")}
      ${tabela("Vencem em até 15 dias", em15, "#D97706")}
      ${tabela("Vencem em até 30 dias", em30, "#D97706")}
      <p style="margin-top:20px"><a href="${SITE}/admin/rh" style="background:#C41E3A;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:700">Abrir o RH no portal</a></p>
      <p style="color:#9CA3AF;font-size:12px;margin-top:24px">Aviso automático — Costa Júnior Engenharia. Alertas em 30, 15 e 7 dias e no dia do vencimento.</p>
    </div>`;

  let enviados = 0, falhas = 0;
  for (const to of String(para).split(",").map((s: string) => s.trim()).filter(Boolean)) {
    try { await enviarEmailSimples({ to, subject: `🚨 RH: ${selecionados.length} documento(s) a vencer/vencido(s)`, html }); enviados++; }
    catch { falhas++; }
  }
  return { total: selecionados.length, enviados, falhas };
}

// ════════════════════════════════════════════════════════════════════════
// Aniversariantes do mês — enviado no dia 1 (pelo cron) para o RH festejar.
// Inclui TODOS os ativos (qualquer regime), pela data de nascimento.
// ════════════════════════════════════════════════════════════════════════
const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

export async function enviarAniversariantesDoMes(db: any, opts: { para?: string; dry?: boolean; mes?: number } = {}) {
  const para = opts.para || RH_ALERT_EMAIL;
  const mes = opts.mes || new Date().getUTCMonth() + 1;
  const { data } = await db.from("rh_colaboradores")
    .select("nome, data_nascimento, cargo, setor")
    .neq("status", "desligado").not("data_nascimento", "is", null).limit(3000);
  const aniv = (data || [])
    .filter((c: any) => Number(String(c.data_nascimento).slice(5, 7)) === mes)
    .sort((a: any, b: any) => Number(String(a.data_nascimento).slice(8, 10)) - Number(String(b.data_nascimento).slice(8, 10)));
  if (!aniv.length) return { total: 0, enviados: 0 };
  if (opts.dry) return { total: aniv.length, dry: true, destino: para };

  const linhas = aniv.map((c: any) => {
    const dia = String(c.data_nascimento).slice(8, 10);
    return `<tr>
      <td style="padding:7px 10px;border-bottom:1px solid #eee;font-weight:700;color:#C41E3A;white-space:nowrap">${dia}/${String(mes).padStart(2, "0")}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #eee"><strong>${c.nome}</strong></td>
      <td style="padding:7px 10px;border-bottom:1px solid #eee;color:#6B7280">${c.cargo || "—"}</td>
    </tr>`;
  }).join("");
  const html = `<div style="font-family:Arial,sans-serif;color:#2D2F36;max-width:680px">
    <h2 style="color:#C41E3A;margin-bottom:4px">🎉 Aniversariantes de ${MESES[mes - 1]}</h2>
    <p style="color:#5B5F6B">${aniv.length} colaborador(es) fazem aniversário neste mês — vamos festejar!</p>
    <table style="border-collapse:collapse;width:100%;font-size:14px">
      <thead><tr style="background:#F4F6F9"><th style="text-align:left;padding:8px 10px">Dia</th><th style="text-align:left;padding:8px 10px">Colaborador</th><th style="text-align:left;padding:8px 10px">Cargo</th></tr></thead>
      <tbody>${linhas}</tbody></table>
    <p style="color:#9CA3AF;font-size:12px;margin-top:24px">Aviso automático — Costa Júnior Engenharia. Enviado no dia 1 de cada mês.</p>
  </div>`;

  let enviados = 0;
  for (const to of String(para).split(",").map((s: string) => s.trim()).filter(Boolean)) {
    try { await enviarEmailSimples({ to, subject: `🎉 Aniversariantes de ${MESES[mes - 1]} (${aniv.length})`, html }); enviados++; } catch { /* ignore */ }
  }
  return { total: aniv.length, enviados };
}
