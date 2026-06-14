// Pesquisa de Clima / eNPS — dimensões e cálculo.
import { enviarEmailSimples } from "./mailer";

const SITE = import.meta.env.SITE_BASE_URL || "https://costajr.com.br";
const RH_EMAIL = import.meta.env.RH_ALERT_EMAIL || "rh@costajr.com.br, adriana@costajr.com.br";

export const DIMENSOES: { k: string; t: string }[] = [
  { k: "ambiente", t: "Ambiente de trabalho" },
  { k: "lideranca", t: "Liderança e gestão" },
  { k: "reconhecimento", t: "Reconhecimento e valorização" },
  { k: "comunicacao", t: "Comunicação interna" },
  { k: "desenvolvimento", t: "Oportunidades de desenvolvimento" },
  { k: "equilibrio", t: "Equilíbrio entre vida e trabalho" },
];

// eNPS = % promotores (9-10) − % detratores (0-6). Passivos = 7-8.
export function calcularEnps(notas: number[]): { score: number; promotores: number; passivos: number; detratores: number; total: number } {
  const vals = notas.filter((n) => typeof n === "number" && n >= 0 && n <= 10);
  const total = vals.length;
  if (!total) return { score: 0, promotores: 0, passivos: 0, detratores: 0, total: 0 };
  const promotores = vals.filter((n) => n >= 9).length;
  const detratores = vals.filter((n) => n <= 6).length;
  const passivos = total - promotores - detratores;
  const score = Math.round(((promotores - detratores) / total) * 100);
  return { score, promotores, passivos, detratores, total };
}

// Classificação do eNPS para o indicador resumido.
export function classeEnps(score: number): { rotulo: string; cor: string } {
  if (score >= 50) return { rotulo: "Excelente", cor: "#16A34A" };
  if (score >= 10) return { rotulo: "Bom", cor: "#65A30D" };
  if (score >= 0) return { rotulo: "Razoável", cor: "#D97706" };
  return { rotulo: "Crítico", cor: "#B91C1C" };
}

// ════════════════════════════════════════════════════════════════════════
// Lembrete trimestral (1º de Mar/Jun/Set/Dez): cobra o preenchimento da
// pesquisa de clima ATIVA. E-mail individual para cada colaborador ativo
// (link anônimo) + cópia para o RH. Chamado pelo cron diário.
// ════════════════════════════════════════════════════════════════════════
export async function enviarLembreteClima(db: any, opts: { dry?: boolean; forcar?: boolean } = {}) {
  const hoje = new Date();
  const ehTrimestre = [3, 6, 9, 12].includes(hoje.getUTCMonth() + 1) && hoje.getUTCDate() === 1;
  if (!ehTrimestre && !opts.forcar) return { enviados: 0, motivo: "fora do 1º dia de trimestre" };

  const { data: pesquisas } = await db.from("rh_clima_pesquisas")
    .select("id, titulo, token, ativa").eq("ativa", true).order("created_at", { ascending: false }).limit(1);
  const p = (pesquisas || [])[0];
  if (!p) return { enviados: 0, motivo: "nenhuma pesquisa de clima ativa" };
  const link = `${SITE}/clima/${p.token}`;

  const { data: colabs } = await db.from("rh_colaboradores")
    .select("email").neq("status", "desligado").not("email", "is", null).limit(3000);
  const emails = [...new Set((colabs || []).map((c: any) => String(c.email).trim()).filter(Boolean))] as string[];
  const destinos: string[] = [...emails, ...String(RH_EMAIL).split(",").map((s) => s.trim()).filter(Boolean)];

  if (opts.dry) return { enviados: 0, dry: true, total: destinos.length, link };

  const html = `<div style="font-family:Arial,sans-serif;color:#2D2F36;max-width:600px">
    <h2 style="color:#C41E3A">🌡️ Pesquisa de Clima — sua opinião importa</h2>
    <p>Estamos ouvindo o time! A pesquisa <strong>${p.titulo}</strong> é <strong>anônima</strong> e leva ~3 minutos.</p>
    <p>Sua resposta ajuda a Costa Júnior a melhorar o ambiente de trabalho. Por favor, participe:</p>
    <p style="margin:18px 0"><a href="${link}" style="background:#C41E3A;color:#fff;text-decoration:none;padding:13px 26px;border-radius:8px;font-weight:700">Responder agora</a></p>
    <p style="color:#9CA3AF;font-size:12px">🔒 Anônima — não identificamos quem respondeu. Costa Júnior Engenharia.</p>
  </div>`;
  let enviados = 0;
  for (const to of destinos) {
    try { await enviarEmailSimples({ to, subject: "🌡️ Pesquisa de Clima — participe (anônima, 3 min)", html }); enviados++; } catch { /* ignore */ }
  }
  return { enviados, total: destinos.length, link };
}
