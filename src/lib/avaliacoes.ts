import { enviarEmailSimples } from "./mailer";

// ════════════════════════════════════════════════════════════════════════
// Avaliação de Desempenho trimestral (Mar/Jun/Set/Dez).
// ════════════════════════════════════════════════════════════════════════

const SITE = import.meta.env.SITE_BASE_URL || "https://costajr.com.br";
export const RH_ALERT_EMAIL = import.meta.env.RH_ALERT_EMAIL || "rh@costajr.com.br, adriana@costajr.com.br";

// Competências avaliadas (nota 1–5). Ordem = exibição.
export const COMPETENCIAS: { k: string; t: string }[] = [
  { k: "qualidade", t: "Qualidade e capricho do trabalho" },
  { k: "produtividade", t: "Produtividade e cumprimento de prazos" },
  { k: "comprometimento", t: "Comprometimento e responsabilidade" },
  { k: "equipe", t: "Trabalho em equipe" },
  { k: "comunicacao", t: "Comunicação" },
  { k: "iniciativa", t: "Iniciativa e proatividade" },
  { k: "assiduidade", t: "Assiduidade e pontualidade" },
  { k: "tecnico", t: "Conhecimento técnico / domínio da função" },
  { k: "seguranca", t: "Segurança (uso de EPI e normas)" },
  { k: "postura", t: "Postura e relacionamento" },
];

export const TRIMESTRES: Record<number, string> = { 1: "1º trim. (Março)", 2: "2º trim. (Junho)", 3: "3º trim. (Setembro)", 4: "4º trim. (Dezembro)" };
export const MES_DO_TRIMESTRE: Record<number, number> = { 1: 3, 2: 6, 3: 9, 4: 12 };

export function notaGeral(respostas: Record<string, any>): number {
  const vals = COMPETENCIAS.map((c) => Number(respostas?.[c.k])).filter((n) => !isNaN(n) && n > 0);
  if (!vals.length) return 0;
  return Math.round((vals.reduce((s, n) => s + n, 0) / vals.length) * 100) / 100;
}

// Trimestre vigente a partir do mês (3→1, 6→2, 9→3, 12→4; outros = o mais próximo já iniciado).
export function trimestreDoMes(mes: number): number {
  if (mes >= 12) return 4; if (mes >= 9) return 3; if (mes >= 6) return 2; if (mes >= 3) return 1; return 4;
}

// Lembrete trimestral (dia 1 de Mar/Jun/Set/Dez): cobra as avaliações pendentes.
export async function enviarLembreteAvaliacoes(db: any, opts: { para?: string; dry?: boolean } = {}) {
  const para = opts.para || RH_ALERT_EMAIL;
  const hoje = new Date();
  const mes = hoje.getUTCMonth() + 1;
  if (![3, 6, 9, 12].includes(mes)) return { disparou: false };
  const ano = hoje.getUTCFullYear();
  const trim = trimestreDoMes(mes);

  const { data: ativos } = await db.from("rh_colaboradores").select("id, nome").neq("status", "desligado").neq("status_juridico", "congelado").limit(2000);
  const { data: feitas } = await db.from("rh_avaliacoes").select("colaborador_id").eq("ano", ano).eq("trimestre", trim).eq("tipo", "gestor");
  const feitoSet = new Set((feitas || []).map((f: any) => f.colaborador_id));
  const pendentes = (ativos || []).filter((c: any) => !feitoSet.has(c.id));
  if (opts.dry) return { disparou: true, pendentes: pendentes.length, total: (ativos || []).length };

  const html = `<div style="font-family:Arial,sans-serif;color:#2D2F36;max-width:680px">
    <h2 style="color:#C41E3A;margin-bottom:4px">📊 Avaliação de Desempenho — ${TRIMESTRES[trim]} ${ano}</h2>
    <p style="color:#5B5F6B">Início do ciclo trimestral. Faltam <strong>${pendentes.length}</strong> de ${(ativos || []).length} colaboradores a avaliar.</p>
    <p style="margin-top:16px"><a href="${SITE}/admin/avaliacoes" style="background:#C41E3A;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:700">Abrir Avaliações</a></p>
    <p style="color:#9CA3AF;font-size:12px;margin-top:24px">Aviso automático — Costa Júnior Engenharia. Ciclos em Março, Junho, Setembro e Dezembro.</p>
  </div>`;
  let enviados = 0;
  for (const to of String(para).split(",").map((s: string) => s.trim()).filter(Boolean)) {
    try { await enviarEmailSimples({ to, subject: `📊 Avaliação de Desempenho ${TRIMESTRES[trim]} ${ano} — ${pendentes.length} pendente(s)`, html }); enviados++; } catch { /* ignore */ }
  }
  return { disparou: true, pendentes: pendentes.length, enviados };
}
