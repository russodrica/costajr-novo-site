import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { requireAdmin, jsonOk, jsonErr, temPerfil } from "~/lib/auth";
import { permissoesDoUsuario } from "~/lib/permissoes";
import { catsDoItem } from "~/lib/junia";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    const claims = await requireAdmin(request);
    const sb = supabaseAdmin();
    const { categoriasKb, perfis } = await permissoesDoUsuario(claims);
    const ehAdmin = perfis.includes("admin"); // admin vê tudo, sempre
    let q = sb.from("portal_kb").select("id, question, answer, category");
    if (!ehAdmin) {
      const filtros = ["access_roles.cs.{all}", ...perfis.map((r) => `access_roles.cs.{${r}}`)].join(",");
      q = q.or(filtros);
    }
    const { data } = await q.order("category").order("created_at");
    if (ehAdmin) return jsonOk(data || []);
    // conteúdo trabalhista só para quem tem a permissão (ou gestão)
    const podeTrabalhista = claims.trabalhista || temPerfil(claims, ["admin", "rh"]);
    const catsOk = new Set(categoriasKb.map((x) => x.toLowerCase()));
    const lista = (data || []).filter((kbe) => {
      const cats = catsDoItem(kbe);
      if (cats.includes("trabalhista") && !podeTrabalhista) return false;
      return cats.some((c) => catsOk.has(c) || c === "geral");
    });
    return jsonOk(lista);
  } catch {
    return jsonErr(401, "Não autenticado.");
  }
};
