import type { APIRoute } from "astro";
import { requireTecnico, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";
import { listarLojaIdsDoTecnico } from "~/lib/manut/tecnicos";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    const claims = await requireTecnico(request);
    const url = new URL(request.url);
    const mes = url.searchParams.get("mes"); // YYYY-MM

    const lojaIds = await listarLojaIdsDoTecnico(claims.sub);
    const filtros: string[] = [`tecnico_atribuido_id.eq.${claims.sub}`];
    if (lojaIds.length > 0) filtros.push(`loja_id.in.(${lojaIds.join(",")})`);

    let q = supabaseAdmin()
      .from("manut_preventivas")
      .select("*, manut_lojas(nome,endereco,cidade,uf), manut_clientes(nome)")
      .or(filtros.join(","))
      .order("data_agendada", { ascending: true });

    if (mes) {
      const ini = mes + "-01";
      const fim = mes + "-31";
      q = q.gte("data_agendada", ini).lte("data_agendada", fim);
    } else {
      // Default: próximos 60 dias
      q = q.gte("data_agendada", new Date().toISOString().slice(0, 10));
    }

    const { data, error } = await q.limit(200);
    if (error) throw new Error(error.message);
    return jsonOk(data || []);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" || e.message === "Token inválido" ? 401 : 500, e.message);
  }
};
