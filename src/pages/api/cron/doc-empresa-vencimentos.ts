import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { verifyToken } from "~/lib/auth";
import { enviarDigestVencimentosDocEmpresa, DOC_EMPRESA_ALERT_EMAIL } from "~/lib/docEmpresaVencimentos";

export const prerender = false;

// Avisa financeiro/jurídico sobre Documentos da Empresa vencendo. Dois gatilhos:
//  - automático: roda DENTRO do cron diário cashback-renovacao (modo "marcos":
//    30/15/7 dias antes + no dia) — não consome novo slot de cron na Vercel.
//  - manual: este endpoint, via botão "Enviar resumo agora" (admin) ou CRON_SECRET,
//    em modo "completo" (todos os vencidos + vencendo 30 dias).
export const GET: APIRoute = async ({ request, url, cookies }) => {
  const auth = request.headers.get("authorization") || "";
  const cronSecret = import.meta.env.CRON_SECRET || "";
  const qsSecret = url.searchParams.get("secret") || "";
  const cronOk = cronSecret && (auth === `Bearer ${cronSecret}` || qsSecret === cronSecret);
  let adminOk = false;
  const tk = cookies.get("admin_token")?.value;
  if (tk) { try { const c = await verifyToken<any>(tk); adminOk = c.tipo === "admin"; } catch { adminOk = false; } }
  if (cronSecret && !cronOk && !adminOk) return new Response("Forbidden", { status: 403 });
  if (!cronSecret && !adminOk) return new Response("Forbidden", { status: 403 });

  const modo = url.searchParams.get("modo") === "marcos" ? "marcos" : "completo";
  const dry = url.searchParams.get("dry") === "1";
  const r = await enviarDigestVencimentosDocEmpresa(supabaseAdmin(), { modo, dry, para: url.searchParams.get("para") || DOC_EMPRESA_ALERT_EMAIL });
  return new Response(JSON.stringify({ ok: true, ...r }), { status: 200, headers: { "content-type": "application/json" } });
};
