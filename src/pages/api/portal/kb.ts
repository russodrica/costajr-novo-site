import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { requireAdmin, jsonOk, jsonErr, perfisDe, temPerfil } from "~/lib/auth";
import { permissoesDoUsuario } from "~/lib/permissoes";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    const claims = await requireAdmin(request);
    const sb = supabaseAdmin();
    const perfis = perfisDe(claims);
    const filtros = ["access_roles.cs.{all}", ...perfis.map((r) => `access_roles.cs.{${r}}`)].join(",");
    const { data } = await sb
      .from("portal_kb")
      .select("id, question, answer, category")
      .or(filtros)
      .order("category")
      .order("created_at");
    // conteúdo trabalhista só para quem tem a permissão (ou gestão)
    const podeTrabalhista = claims.trabalhista || temPerfil(claims, ["admin", "rh"]);
    const { categoriasKb } = await permissoesDoUsuario(claims);
    const catsOk = new Set(categoriasKb.map((x) => x.toLowerCase()));
    const lista = (data || []).filter((kbe) => {
      const cat = (kbe.category || "Geral").toLowerCase();
      if (cat === "trabalhista" && !podeTrabalhista) return false;
      return catsOk.has(cat) || cat === "geral";
    });
    return jsonOk(lista);
  } catch {
    return jsonErr(401, "Não autenticado.");
  }
};
