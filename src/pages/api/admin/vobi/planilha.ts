import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../lib/auth";
import { bloqueioSeSemLeitura } from "../../../../lib/permissoes";
import { supabaseAdmin } from "../../../../lib/supabase";
import { getGrupoFinanceiro } from "../../../../lib/financeiroFlow";
import { listarPedidos, pedirPlanilha, statusPonte, INTERVALO_MIN } from "../../../../lib/planilhaFinanceira";

export const prerender = false;

// Planilha financeira sob demanda (botão do portal). Ver src/lib/planilhaFinanceira.ts.
//   GET  /api/admin/vobi/planilha            → últimos pedidos + se o computador está ligado
//   POST /api/admin/vobi/planilha {forcar?}  → pede uma planilha nova
// O arquivo NÃO passa por aqui: quem gera é o computador da Adriana, que salva
// na pasta 02_Fluxos e manda no grupo financeiro do Telegram.

function erroHttp(e: any) {
  const msg = e?.message || "Falha";
  return jsonErr(msg === "Não autenticado" || msg === "Token inválido" ? 401 : msg === "Sem permissão" ? 403 : 500, msg);
}

export const GET: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const ro = await bloqueioSeSemLeitura(admin, "vobi-financeiro");
    if (ro) return ro;
    const db = supabaseAdmin();
    const [pedidos, ponte] = await Promise.all([listarPedidos(db, 8), statusPonte(db)]);
    return jsonOk({ pedidos, ponte, intervalo_min: INTERVALO_MIN });
  } catch (e: any) {
    return erroHttp(e);
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const ro = await bloqueioSeSemLeitura(admin, "vobi-financeiro");
    if (ro) return ro;
    const body: any = await request.json().catch(() => ({}));
    const db = supabaseAdmin();
    // o arquivo vai para o grupo financeiro do Telegram (se estiver ativado)
    const chatId = await getGrupoFinanceiro(db);
    const r = await pedirPlanilha(db, {
      origem: "portal",
      solicitante: admin.email || "",
      chatId,
      forcar: body?.forcar === true,
    });
    return jsonOk({ ...r, grupo_telegram: !!chatId, intervalo_min: INTERVALO_MIN });
  } catch (e: any) {
    return erroHttp(e);
  }
};
