import type { APIRoute } from "astro";
import { requireAdminCookie, temPerfil, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";

export const prerender = false;
const PERFIS = ["admin"];

// GET → lista alertas (por padrão só os não resolvidos; ?todos=1 traz tudo)
export const GET: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const url = new URL(request.url);
    const todos = url.searchParams.get("todos") === "1";

    const db = supabaseAdmin();
    let q = db.from("vendas_alertas")
      .select("*, vendas_produtos(nome, sku_trazpraca)")
      .order("created_at", { ascending: false })
      .limit(200);
    if (!todos) q = q.eq("resolvido", false);
    const { data, error } = await q;
    if (error) return jsonErr(400, error.message);
    return jsonOk({ alertas: data || [] });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
