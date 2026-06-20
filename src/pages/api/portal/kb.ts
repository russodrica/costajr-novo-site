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
    // Acesso da Base de Conhecimento é dado SÓ pelas CATEGORIAS (decisão da Adriana):
    // busca tudo e filtra por categoria abaixo (access_roles não governa mais a KB).
    const { data } = await sb.from("portal_kb").select("id, question, answer, category").order("category").order("created_at");
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
