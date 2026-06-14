import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";

export const prerender = false;

// GET /api/admin/lixeira?entidade=&incluir_restaurados=&pagina=
//   Itens excluídos recuperáveis (até 30 dias). Só admin/coordenador.
export const GET: APIRoute = async ({ request, url }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!["admin", "coordenador"].includes(admin.role)) return jsonErr(403, "Sem permissão para ver a lixeira.");
    const db = supabaseAdmin();

    const pagina = Math.max(1, parseInt(url.searchParams.get("pagina") || "1", 10));
    const porPagina = 50;
    const ini = (pagina - 1) * porPagina;

    let q = db.from("lixeira").select("*", { count: "exact" }).order("excluido_em", { ascending: false });
    const entidade = url.searchParams.get("entidade");
    if (entidade && entidade !== "todos") q = q.eq("entidade", entidade);
    if (url.searchParams.get("incluir_restaurados") !== "1") q = q.eq("restaurado", false);

    const { data, error, count } = await q.range(ini, ini + porPagina - 1);
    if (error) return jsonErr(500, error.message);

    const { data: ents } = await db.from("lixeira").select("entidade").limit(2000);
    const entidades = [...new Set((ents || []).map((e: any) => e.entidade))].sort();

    return jsonOk({ itens: data || [], total: count || 0, pagina, porPagina, entidades });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
