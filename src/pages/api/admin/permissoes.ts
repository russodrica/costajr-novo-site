import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../lib/auth";
import { supabaseAdmin } from "../../../lib/supabase";
import { AREAS_PORTAL, CATEGORIAS_KB, PERFIS } from "../../../lib/permissoes";

export const prerender = false;

// GET /api/admin/permissoes — matriz completa
export const GET: APIRoute = async ({ request }) => {
  try {
    await requireAdminCookie(request);
    const { data, error } = await supabaseAdmin().from("portal_permissoes").select("*").order("perfil");
    if (error) return jsonErr(500, error.message);
    return jsonOk({ permissoes: data || [], areas: AREAS_PORTAL, categorias: CATEGORIAS_KB, perfis: PERFIS });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// PUT /api/admin/permissoes — body: { permissoes: [{perfil, areas, categorias_kb}] }
export const PUT: APIRoute = async ({ request }) => {
  try {
    await requireAdminCookie(request);
    const { permissoes } = await request.json();
    if (!Array.isArray(permissoes)) return jsonErr(400, "Formato inválido");

    const areasValidas = new Set<string>(AREAS_PORTAL.map((a) => a.id as string));
    const catsValidas = new Set<string>(CATEGORIAS_KB as unknown as string[]);
    const db = supabaseAdmin();

    for (const p of permissoes) {
      if (!PERFIS.includes(p.perfil)) continue;
      // admin é intocável: sempre acesso total (evita se trancar fora)
      const areas = p.perfil === "admin"
        ? AREAS_PORTAL.map((a) => a.id)
        : (p.areas || []).filter((a: string) => areasValidas.has(a));
      const categorias = p.perfil === "admin"
        ? [...catsValidas]
        : (p.categorias_kb || []).filter((c: string) => catsValidas.has(c));
      const { error } = await db.from("portal_permissoes").upsert({
        perfil: p.perfil, areas, categorias_kb: categorias, updated_at: new Date().toISOString(),
      }, { onConflict: "perfil" });
      if (error) return jsonErr(400, `${p.perfil}: ${error.message}`);
    }
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
