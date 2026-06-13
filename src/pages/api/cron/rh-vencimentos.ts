import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { verifyToken } from "~/lib/auth";
import { enviarDigestVencimentosRh, RH_ALERT_EMAIL } from "~/lib/rhVencimentos";

export const prerender = false;

// Avisa o RH (rh@costajr.com.br) sobre documentos vencendo. Dois gatilhos:
//  - automático: roda DENTRO do cron diário cashback-renovacao (modo "marcos":
//    30/15/7 dias antes + no dia) — não precisa de novo slot de cron na Vercel.
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

  // modo padrão: "completo" quando disparado manualmente; "marcos" se ?modo=marcos
  const modo = url.searchParams.get("modo") === "marcos" ? "marcos" : "completo";
  const dry = url.searchParams.get("dry") === "1";
  const r = await enviarDigestVencimentosRh(supabaseAdmin(), { modo, dry, para: url.searchParams.get("para") || RH_ALERT_EMAIL });
  return new Response(JSON.stringify({ ok: true, ...r }), { status: 200, headers: { "content-type": "application/json" } });
};
