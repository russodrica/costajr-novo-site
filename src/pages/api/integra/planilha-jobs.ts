import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/supabase";
import { registrarPonte, pegarProximoPedido, concluirPedido } from "../../../lib/planilhaFinanceira";

export const prerender = false;

// ════════════════════════════════════════════════════════════════════════
// Ponte da PLANILHA FINANCEIRA (roda no computador da Adriana, a cada minuto —
// scripts/planilha-ponte.mjs). Ver src/lib/planilhaFinanceira.ts.
//
// Protegido pelo mesmo segredo das outras integrações (INTEGRA_TELEGRAM_SECRET).
//   GET  /api/integra/planilha-jobs?maquina=X  → "estou vivo" + pega o próximo
//                                                 pedido pendente (ou null)
//   POST /api/integra/planilha-jobs {id, ok, arquivo?, erro?} → fecha o pedido
//
// O arquivo gerado NÃO passa por aqui: a ponte salva na pasta 02_Fluxos e
// manda direto pro Telegram. Aqui só circula o registro do pedido (texto).
// ════════════════════════════════════════════════════════════════════════

function env(n: string) { return (import.meta.env as any)[n] || (process.env as any)[n] || ""; }
const SECRET = env("INTEGRA_TELEGRAM_SECRET");

const json = (body: any, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function autorizado(request: Request): boolean {
  if (!SECRET) return false;
  return (request.headers.get("x-integra-secret") || "") === SECRET;
}

export const GET: APIRoute = async ({ request, url }) => {
  try {
    if (!SECRET) return json({ ok: false, error: "INTEGRA_TELEGRAM_SECRET não configurado" }, 503);
    if (!autorizado(request)) return json({ ok: false, error: "não autorizado" }, 401);
    const db = supabaseAdmin();
    await registrarPonte(db, (url.searchParams.get("maquina") || "").slice(0, 60) || null);
    // ?ping=1: só "estou vivo" (a ponte está ocupada gerando e não pode pegar outro)
    if (url.searchParams.get("ping") === "1") return json({ ok: true, pedido: null });
    const pedido = await pegarProximoPedido(db);
    return json({ ok: true, pedido });
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    if (!SECRET) return json({ ok: false, error: "INTEGRA_TELEGRAM_SECRET não configurado" }, 503);
    if (!autorizado(request)) return json({ ok: false, error: "não autorizado" }, 401);
    const body: any = await request.json().catch(() => ({}));
    const id = String(body.id || "").replace(/[^a-z0-9]/gi, "");
    if (!id) return json({ ok: false, error: "informe o id do pedido" }, 400);
    await concluirPedido(supabaseAdmin(), id, {
      ok: body.ok === true,
      arquivo: typeof body.arquivo === "string" ? body.arquivo.slice(0, 200) : undefined,
      erro: typeof body.erro === "string" ? body.erro : undefined,
    });
    return json({ ok: true });
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
};
