import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { requireAdmin, jsonOk, jsonErr } from "~/lib/auth";
import { exigirArea } from "~/lib/permissoes";

export const prerender = false;

// GET /api/portal/comercial/interacoes?dias=30 — para os rankings
export const GET: APIRoute = async ({ request, url }) => {
  try {
    const claims = await requireAdmin(request);
    try { await exigirArea(claims, "comercial"); } catch (e: any) { return jsonErr(403, e.message); }
    const dias = Math.min(365, Math.max(1, Number(url.searchParams.get("dias")) || 30));
    const desde = new Date(Date.now() - dias * 864e5).toISOString();
    const { data, error } = await supabaseAdmin()
      .from("manut_leads_interacoes")
      .select("id, lead_id, tipo, vendedor, created_at")
      .gte("created_at", desde)
      .order("created_at", { ascending: false })
      .limit(2000);
    if (error) return jsonErr(500, error.message);
    return jsonOk(data || []);
  } catch {
    return jsonErr(401, "Não autenticado.");
  }
};

// POST — registra interação e atualiza o "última interação" do lead
// body: { lead_id, tipo, observacao? }
export const POST: APIRoute = async ({ request }) => {
  try {
    const claims = await requireAdmin(request);
    try { await exigirArea(claims, "comercial"); } catch (e: any) { return jsonErr(403, e.message); }
    const { lead_id, tipo, observacao } = await request.json();
    if (!lead_id || !["whatsapp", "ligacao", "email", "visita", "outro"].includes(tipo)) {
      return jsonErr(400, "Informe o lead e o tipo de contato.");
    }
    const sb = supabaseAdmin();
    const agora = new Date().toISOString();
    const { data, error } = await sb.from("manut_leads_interacoes").insert({
      lead_id, tipo, observacao: observacao || null, vendedor: claims.email || "—",
    }).select().single();
    if (error) return jsonErr(400, error.message);
    await sb.from("manut_leads").update({ ultima_interacao_em: agora, updated_at: agora }).eq("id", lead_id);
    return jsonOk(data, 201);
  } catch {
    return jsonErr(401, "Não autenticado.");
  }
};
