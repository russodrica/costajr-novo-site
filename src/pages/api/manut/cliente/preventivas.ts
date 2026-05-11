import type { APIRoute } from "astro";
import { requireCliente, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    const claims = await requireCliente(request);
    const db = supabaseAdmin();
    const { data, error } = await db
      .from("manut_preventivas")
      .select("*, manut_lojas(nome,cidade,uf), manut_tecnicos(nome)")
      .eq("cliente_id", claims.sub)
      .order("data_agendada", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);

    // Auto-heal: preventivas concluídas sem relatorio_url ganham o link
    const semUrl = (data || []).filter(p => p.status === "concluida" && !p.relatorio_url);
    if (semUrl.length) {
      await Promise.all(semUrl.map(p =>
        db.from("manut_preventivas")
          .update({ relatorio_url: `/manutencao/preventiva/${p.id}/relatorio` })
          .eq("id", p.id)
      ));
      semUrl.forEach(p => { p.relatorio_url = `/manutencao/preventiva/${p.id}/relatorio`; });
    }

    return jsonOk(data || []);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" || e.message === "Token inválido" ? 401 : 500, e.message);
  }
};
