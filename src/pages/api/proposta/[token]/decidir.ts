import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { jsonOk, jsonErr } from "~/lib/auth";

export const prerender = false;

// POST /api/proposta/[token]/decidir — endpoint PÚBLICO (cliente decide pela página do link).
// body: { acao: "aceitar"|"recusar", nome?, motivo? }
export const POST: APIRoute = async ({ request, params, clientAddress }) => {
  try {
    const db = supabaseAdmin();
    const { data: p } = await db.from("com_propostas").select("*").eq("token", params.token!).maybeSingle();
    if (!p) return jsonErr(404, "Proposta não encontrada");
    if (p.status === "aceita") return jsonOk(p);
    if (p.status === "recusada") return jsonErr(400, "Proposta já recusada");

    const hoje = new Date().toISOString().slice(0, 10);
    if (p.valido_ate && p.valido_ate < hoje) return jsonErr(400, "Proposta expirada — fale com nosso comercial");

    const { acao, nome, motivo } = await request.json();
    let ip = "";
    try { ip = clientAddress || ""; } catch { /* indisponível em alguns ambientes */ }
    if (!ip) ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "";

    if (acao === "aceitar") {
      if (!nome || String(nome).trim().length < 3) return jsonErr(400, "Informe o nome do responsável pelo aceite");
      const { data, error } = await db.from("com_propostas").update({
        status: "aceita",
        aceita_em: new Date().toISOString(),
        aceite_nome: String(nome).trim().slice(0, 120),
        aceite_ip: ip || null,
        updated_at: new Date().toISOString(),
      }).eq("id", p.id).select().single();
      if (error) return jsonErr(400, error.message);
      // lead vinculado vira convertido no funil
      if (p.lead_id) await db.from("manut_leads").update({ etapa: "convertido", updated_at: new Date().toISOString() }).eq("id", p.lead_id);
      return jsonOk(data);
    }

    if (acao === "recusar") {
      const { data, error } = await db.from("com_propostas").update({
        status: "recusada",
        recusa_motivo: motivo ? String(motivo).slice(0, 500) : null,
        updated_at: new Date().toISOString(),
      }).eq("id", p.id).select().single();
      if (error) return jsonErr(400, error.message);
      return jsonOk(data);
    }

    return jsonErr(400, "Ação inválida");
  } catch (e: any) {
    return jsonErr(500, e.message);
  }
};
