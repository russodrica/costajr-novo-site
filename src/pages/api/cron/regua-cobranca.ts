import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { enviarLembretePagamento } from "~/lib/mailer";

export const prerender = false;

// Cron diário (Vercel — ver vercel.json). Régua de cobrança dos pagamentos
// de manutenção (manut_pagamentos):
//   - 3 dias antes do vencimento  → lembrete "vence em breve"
//   - no dia do vencimento        → lembrete "vence hoje"
//   - 3 dias após o vencimento    → cobrança "em aberto"
// Cada pagamento recebe no máximo 1 e-mail por estágio (controle via colunas
// lembrete_* — criadas na migration 027b... usa observação simples: updated marker
// em manut_pagamentos.regua_estagio).
export const GET: APIRoute = async ({ request, url }) => {
  const auth = request.headers.get("authorization") || "";
  const cronSecret = import.meta.env.CRON_SECRET || "";
  const qsSecret = url.searchParams.get("secret") || "";
  const vercelCron = auth === `Bearer ${cronSecret}`;
  const manual = cronSecret && qsSecret === cronSecret;
  if (cronSecret && !vercelCron && !manual) return new Response("Forbidden", { status: 403 });

  const db = supabaseAdmin();
  const hoje = new Date(); hoje.setHours(12, 0, 0, 0);
  const dia = (n: number) => { const d = new Date(hoje); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

  // pagamentos pendentes/atrasados com vencimento na janela de interesse
  const { data: pagamentos, error } = await db
    .from("manut_pagamentos")
    .select("id, valor, referencia, status, data_vencimento, regua_estagio, manut_clientes(nome, email)")
    .in("status", ["pendente", "atrasado"])
    .gte("data_vencimento", dia(-4))
    .lte("data_vencimento", dia(4));
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  let enviados = 0, pulados = 0, falhas = 0;
  for (const p of pagamentos || []) {
    const cli: any = p.manut_clientes;
    if (!cli?.email) { pulados++; continue; }
    const venc = String(p.data_vencimento).slice(0, 10);

    let situacao: "vence_em_breve" | "vence_hoje" | "atrasado" | null = null;
    if (venc === dia(3)) situacao = "vence_em_breve";
    else if (venc === dia(0)) situacao = "vence_hoje";
    else if (venc === dia(-3)) situacao = "atrasado";
    if (!situacao) { pulados++; continue; }
    if (p.regua_estagio === situacao) { pulados++; continue; } // já enviado neste estágio

    try {
      await enviarLembretePagamento({
        email: cli.email,
        nome: cli.nome || "cliente",
        referencia: p.referencia || venc,
        valor: Number(p.valor) || 0,
        vencimento: new Date(venc + "T12:00:00").toLocaleDateString("pt-BR"),
        situacao,
      });
      await db.from("manut_pagamentos").update({ regua_estagio: situacao }).eq("id", p.id);
      enviados++;
    } catch {
      falhas++;
    }
  }

  return new Response(JSON.stringify({ ok: true, enviados, pulados, falhas, analisados: pagamentos?.length || 0 }), {
    headers: { "content-type": "application/json" },
  });
};
