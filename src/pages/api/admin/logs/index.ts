import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";

export const prerender = false;

// GET /api/admin/logs?acao=&entidade=&usuario=&q=&desde=&ate=&pagina=
//   Trilha de auditoria, paginada (50/página), só admin/coordenador.
export const GET: APIRoute = async ({ request, url }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!["admin"].includes(admin.role)) return jsonErr(403, "Sem permissão para ver os logs.");
    const db = supabaseAdmin();

    const pagina = Math.max(1, parseInt(url.searchParams.get("pagina") || "1", 10));
    const porPagina = 50;
    const ini = (pagina - 1) * porPagina;

    let q = db.from("audit_log").select("*", { count: "exact" }).order("ts", { ascending: false });
    const acao = url.searchParams.get("acao");
    const entidade = url.searchParams.get("entidade");
    const usuario = url.searchParams.get("usuario");
    const busca = url.searchParams.get("q");
    const desde = url.searchParams.get("desde");
    const ate = url.searchParams.get("ate");
    if (acao && acao !== "todos") q = q.eq("acao", acao);
    if (entidade && entidade !== "todos") q = q.eq("entidade", entidade);
    if (usuario) q = q.ilike("usuario_email", `%${usuario}%`);
    if (busca) q = q.ilike("descricao", `%${busca.replace(/[%,()]/g, " ").trim()}%`);
    if (desde) q = q.gte("ts", desde);
    if (ate) q = q.lte("ts", ate + "T23:59:59");

    const { data, error, count } = await q.range(ini, ini + porPagina - 1);
    if (error) return jsonErr(500, error.message);

    // entidades distintas p/ o filtro (amostra recente)
    const { data: ents } = await db.from("audit_log").select("entidade").order("ts", { ascending: false }).limit(1000);
    const entidades = [...new Set((ents || []).map((e: any) => e.entidade))].sort();

    return jsonOk({ logs: data || [], total: count || 0, pagina, porPagina, entidades });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
