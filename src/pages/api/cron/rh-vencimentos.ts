import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { enviarEmailSimples } from "~/lib/mailer";
import { verifyToken } from "~/lib/auth";

export const prerender = false;

// Avisa o RH/admin por e-mail sobre documentos vencidos ou vencendo nos próximos
// 7 dias (ASO, CNH, NRs...). Dois gatilhos:
//   - automático: cron diário (se registrado no vercel.json) via CRON_SECRET
//   - manual: botão "Enviar resumo agora" no admin (via cookie admin_token)
const SITE = import.meta.env.SITE_BASE_URL || "https://costajr.com.br";
const CRITICOS = new Set(["aso", "cnh"]);
const fmt = (d: string) => d.split("-").reverse().join("/");

export const GET: APIRoute = async ({ request, url, cookies }) => {
  const auth = request.headers.get("authorization") || "";
  const cronSecret = import.meta.env.CRON_SECRET || "";
  const qsSecret = url.searchParams.get("secret") || "";
  const cronOk = cronSecret && (auth === `Bearer ${cronSecret}` || qsSecret === cronSecret);
  // alternativa: admin logado dispara manualmente
  let adminOk = false;
  const tk = cookies.get("admin_token")?.value;
  if (tk) { try { const c = await verifyToken<any>(tk); adminOk = c.tipo === "admin"; } catch { adminOk = false; } }
  if (cronSecret && !cronOk && !adminOk) return new Response("Forbidden", { status: 403 });
  if (!cronSecret && !adminOk) return new Response("Forbidden", { status: 403 });

  const db = supabaseAdmin();
  const hoje = new Date().toISOString().slice(0, 10);
  const em7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  // docs vencidos OU vencendo nos próximos 7 dias
  const { data: docs, error } = await db.from("rh_documentos")
    .select("titulo, tipo, validade, rh_colaboradores(nome)")
    .not("validade", "is", null).lte("validade", em7).order("validade", { ascending: true }).limit(2000);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  const lista = (docs || []).filter((d: any) => d.validade <= em7);
  if (!lista.length) return new Response(JSON.stringify({ ok: true, total: 0, enviados: 0 }), { status: 200, headers: { "content-type": "application/json" } });

  // destinatários: perfis com papel admin ou rh e e-mail
  const { data: perfis } = await db.from("portal_profiles").select("email, role, roles").eq("approval_status", "approved");
  const dest = [...new Set((perfis || [])
    .filter((p: any) => p.email && ((p.roles || [p.role]).some((r: string) => ["admin", "rh"].includes(r))))
    .map((p: any) => p.email))];
  const fallback = import.meta.env.RH_ALERT_EMAIL || import.meta.env.EMAIL_FROM;
  const destinatarios = dest.length ? dest : (fallback ? [fallback] : []);
  if (!destinatarios.length) return new Response(JSON.stringify({ ok: true, total: lista.length, enviados: 0, aviso: "sem destinatários" }), { status: 200, headers: { "content-type": "application/json" } });

  const linhaDoc = (d: any) => {
    const venc = d.validade < hoje;
    const cor = venc ? "#B91C1C" : "#D97706";
    const crit = CRITICOS.has(d.tipo) ? "🔴 " : "";
    return `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee">${crit}<strong>${d.titulo}</strong></td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee">${d.rh_colaboradores?.nome || "—"}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee">${fmt(d.validade)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;color:${cor};font-weight:700">${venc ? "VENCIDO" : "vence em breve"}</td>
    </tr>`;
  };
  const vencidos = lista.filter((d: any) => d.validade < hoje).length;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px">
      <h2 style="color:#2D2F36">🚨 Documentos de RH exigindo atenção</h2>
      <p style="color:#5B5F6B">${vencidos} vencido(s) e ${lista.length - vencidos} vencendo nos próximos 7 dias. Documentos críticos (ASO/CNH) marcados com 🔴.</p>
      <table style="border-collapse:collapse;width:100%;font-size:14px">
        <thead><tr style="background:#F4F6F9"><th style="text-align:left;padding:8px 10px">Documento</th><th style="text-align:left;padding:8px 10px">Colaborador</th><th style="text-align:left;padding:8px 10px">Validade</th><th style="text-align:left;padding:8px 10px">Situação</th></tr></thead>
        <tbody>${lista.map(linhaDoc).join("")}</tbody>
      </table>
      <p style="margin-top:20px"><a href="${SITE}/admin/rh" style="background:#C41E3A;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:700">Abrir o RH no portal</a></p>
      <p style="color:#9CA3AF;font-size:12px;margin-top:24px">Aviso automático diário — Costa Júnior Engenharia.</p>
    </div>`;

  let enviados = 0, falhas = 0;
  for (const to of destinatarios) {
    try { await enviarEmailSimples({ to, subject: `🚨 RH: ${lista.length} documento(s) vencido(s)/vencendo`, html }); enviados++; }
    catch { falhas++; }
  }
  return new Response(JSON.stringify({ ok: true, total: lista.length, enviados, falhas }), { status: 200, headers: { "content-type": "application/json" } });
};
