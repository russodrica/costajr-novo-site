import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";
import { registrarAcao } from "../../../../lib/auditoria";
import { bloqueioSeSoLeitura, bloqueioSeSemLeitura } from "../../../../lib/permissoes";

export const prerender = false;

const MODULO = "negocios";

/** Nome de exibição de quem está escrevendo (cai no e-mail se não achar). */
async function nomeDoAutor(db: any, claims: any): Promise<string> {
  try {
    const { data } = await db.from("portal_profiles").select("display_name, full_name, email").eq("id", claims.sub).maybeSingle();
    return data?.display_name || data?.full_name || claims.email || "—";
  } catch { return claims.email || "—"; }
}

// GET /api/admin/negocios/conversas?imovel_id=...
export const GET: APIRoute = async ({ request, url }) => {
  try {
    const admin = await requireAdminCookie(request);
    const ro = await bloqueioSeSemLeitura(admin, MODULO); if (ro) return ro;
    const db = supabaseAdmin();
    const imovelId = url.searchParams.get("imovel_id") || "";
    let q = db.from("negocios_conversas").select("*").order("data", { ascending: false }).order("created_at", { ascending: false }).limit(1000);
    if (imovelId) q = q.eq("imovel_id", imovelId);
    const { data, error } = await q;
    if (error) return jsonErr(400, error.message);
    return jsonOk(data || []);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// POST /api/admin/negocios/conversas  { imovel_id, data, texto }
// O AUTOR vem do usuário logado, nunca do formulário — histórico de negociação
// precisa dizer a verdade sobre quem escreveu.
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const bl = await bloqueioSeSoLeitura(admin, MODULO); if (bl) return bl;
    const db = supabaseAdmin();

    const body = await request.json().catch(() => null);
    if (!body) return jsonErr(400, "Envie os dados da anotação.");
    const imovel_id = String(body.imovel_id || "").trim();
    if (!imovel_id) return jsonErr(400, "Cadastro não informado.");
    const { data: imovel } = await db.from("negocios_imoveis").select("id, titulo").eq("id", imovel_id).maybeSingle();
    if (!imovel) return jsonErr(404, "Cadastro não encontrado.");

    const texto = String(body.texto || "").trim();
    if (!texto) return jsonErr(400, "Escreva o que aconteceu.");
    const dataStr = String(body.data || "").trim() || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataStr)) return jsonErr(400, "Data inválida.");

    const autor = await nomeDoAutor(db, admin);
    const { data, error } = await db.from("negocios_conversas")
      .insert({ imovel_id, data: dataStr, texto, autor, criado_por: admin.email }).select().single();
    if (error) return jsonErr(400, error.message);

    // toca o cadastro para ele não aparecer como "parado" no Resumo
    await db.from("negocios_imoveis").update({ updated_at: new Date().toISOString() }).eq("id", imovel_id);

    await registrarAcao(db, { req: request, admin }, {
      acao: "criar", entidade: "negocios_conversas", registro_id: data.id,
      descricao: `Anotou no histórico de ${imovel.titulo}`, dados: { imovel_id, data: dataStr },
    });
    return jsonOk(data, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
