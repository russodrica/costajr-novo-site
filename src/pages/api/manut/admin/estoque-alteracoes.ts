import type { APIRoute } from "astro";
import { jsonOk, jsonErr, verifyToken, type AdminClaims } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";

export const prerender = false;

async function ensureAdmin(request: Request) {
  const cookie = request.headers.get("cookie") || "";
  const m = cookie.match(/admin_token=([^;]+)/);
  if (!m) throw new Error("Não autorizado");
  const claims = await verifyToken<AdminClaims>(m[1]);
  if (claims.tipo !== "admin") throw new Error("Não autorizado");
  return claims;
}

export const GET: APIRoute = async ({ request, url }) => {
  try {
    await ensureAdmin(request);
    const status = url.searchParams.get("status") || "todos";
    let q = supabaseAdmin()
      .from("manut_estoque_alteracoes")
      .select("*, manut_estoque(nome,unidade,loja_id,manut_lojas(nome,manut_clientes(nome))), manut_tecnicos(nome,email)")
      .order("created_at", { ascending: false })
      .limit(200);
    if (status !== "todos") q = q.eq("status", status);
    const { data, error } = await q;
    if (error) return jsonErr(500, error.message);
    return jsonOk(data || []);
  } catch (e: any) {
    return jsonErr(e.message === "Não autorizado" ? 401 : 500, e.message);
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    await ensureAdmin(request);
    const { id, acao, resposta } = await request.json();
    if (!id || !["aprovar", "rejeitar"].includes(acao)) return jsonErr(400, "Parâmetros inválidos");
    const db = supabaseAdmin();

    const { data: alt } = await db
      .from("manut_estoque_alteracoes")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (!alt) return jsonErr(404, "Alteração não encontrada");
    if (alt.status !== "pendente") return jsonErr(400, "Alteração já decidida");

    if (acao === "aprovar") {
      // Aplica o novo preço no item
      await db
        .from("manut_estoque")
        .update({ preco_unitario: alt.preco_novo, updated_at: new Date().toISOString() })
        .eq("id", alt.estoque_id);
    }

    const { data, error } = await db
      .from("manut_estoque_alteracoes")
      .update({
        status: acao === "aprovar" ? "aprovada" : "rejeitada",
        resposta_admin: resposta || null,
        decidido_em: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .single();
    if (error) return jsonErr(400, error.message);
    return jsonOk(data);
  } catch (e: any) {
    return jsonErr(e.message === "Não autorizado" ? 401 : 500, e.message);
  }
};
