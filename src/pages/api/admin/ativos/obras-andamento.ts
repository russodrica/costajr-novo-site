import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";
import { vobiObrasAndamento, vobiConfigurado } from "../../../../lib/vobi";

export const prerender = false;

// GET /api/admin/ativos/obras-andamento
// Lista as obras EM ANDAMENTO (idStatus 5 da Vobi = vendida/em execução), AO VIVO.
// Casa com a obra local pelo vobi_id (p/ preencher obra_id quando existir). Se a Vobi
// não estiver configurada/responder, cai para as obras locais com status "ativa".
export const GET: APIRoute = async ({ request }) => {
  try {
    await requireAdminCookie(request);
    const db = supabaseAdmin();

    if (vobiConfigurado()) {
      try {
        const obras = await vobiObrasAndamento();
        const { data: locais } = await db.from("obras").select("id, vobi_id");
        // obras.vobi_id vem com prefixo "vobi-" (ex.: vobi-409251); o refurbish.id é puro.
        const byVobi = new Map<string, string>((locais || []).filter((o) => o.vobi_id != null).map((o) => [String(o.vobi_id).replace(/^vobi-/, ""), o.id]));
        const lista = obras.map((o) => ({
          obra_id: byVobi.get(String(o.vobiId)) || null,
          vobi_id: o.vobiId,
          nome: o.nome,
          cliente: o.cliente,
          cidade: o.cidade,
        }));
        return jsonOk({ fonte: "vobi", obras: lista });
      } catch {
        /* cai no fallback local */
      }
    }

    const { data } = await db.from("obras").select("id, nome, cliente, cidade").eq("status", "ativa").order("nome");
    const lista = (data || []).map((o) => ({ obra_id: o.id, vobi_id: null, nome: o.nome, cliente: o.cliente, cidade: o.cidade }));
    return jsonOk({ fonte: "local", obras: lista });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message || "Falha ao listar obras em andamento.");
  }
};
