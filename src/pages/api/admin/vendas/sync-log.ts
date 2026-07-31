import type { APIRoute } from "astro";
import { requireAdminCookie, temPerfil, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";

export const prerender = false;
const PERFIS = ["admin"];

// GET → últimas execuções do worker de sincronização (trazpraca-automacao).
// O worker (GitHub Actions/Python) grava direto no Supabase via service role key —
// este endpoint é só leitura, pro dashboard.
export const GET: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");

    const db = supabaseAdmin();
    const { data, error } = await db.from("vendas_sync_log")
      .select("*").order("executado_em", { ascending: false }).limit(50);
    if (error) return jsonErr(400, error.message);
    return jsonOk({ execucoes: data || [] });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
