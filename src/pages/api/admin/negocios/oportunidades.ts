import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";
import { registrarAcao } from "../../../../lib/auditoria";
import { bloqueioSeSoLeitura, bloqueioSeSemLeitura } from "../../../../lib/permissoes";
import { limparCamposOportunidade, FUNIL_VALORES, funilLabel } from "../../../../lib/negocios";

export const prerender = false;

const MODULO = "negocios";

// GET /api/admin/negocios/oportunidades?imovel_id=...
export const GET: APIRoute = async ({ request, url }) => {
  try {
    const admin = await requireAdminCookie(request);
    const ro = await bloqueioSeSemLeitura(admin, MODULO); if (ro) return ro;
    const imovelId = url.searchParams.get("imovel_id") || "";
    const db = supabaseAdmin();
    let q = db.from("negocios_oportunidades").select("*").order("created_at", { ascending: false }).limit(1000);
    if (imovelId) q = q.eq("imovel_id", imovelId);
    const { data, error } = await q;
    if (error) return jsonErr(400, error.message);
    return jsonOk(data || []);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// POST /api/admin/negocios/oportunidades — cadastra um interessado no card.
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const bl = await bloqueioSeSoLeitura(admin, MODULO); if (bl) return bl;
    const db = supabaseAdmin();

    const body = await request.json().catch(() => null);
    if (!body) return jsonErr(400, "Envie os dados do interessado.");
    const imovel_id = String(body.imovel_id || "").trim();
    if (!imovel_id) return jsonErr(400, "Cadastro não informado.");
    const { data: imovel } = await db.from("negocios_imoveis").select("id, titulo").eq("id", imovel_id).maybeSingle();
    if (!imovel) return jsonErr(404, "Cadastro não encontrado.");

    const campos = limparCamposOportunidade(body);
    if (!campos.nome) return jsonErr(400, "Informe o nome do interessado.");
    if (!campos.status || !FUNIL_VALORES.includes(campos.status)) campos.status = "contatado";
    if (campos.status === "fechado" && !campos.fechado_em) campos.fechado_em = new Date().toISOString().slice(0, 10);

    const { data, error } = await db.from("negocios_oportunidades")
      .insert({ ...campos, imovel_id, criado_por: admin.email }).select().single();
    if (error) return jsonErr(400, error.message);

    await registrarAcao(db, { req: request, admin }, {
      acao: "criar", entidade: "negocios_oportunidades", registro_id: data.id,
      descricao: `Cadastrou interessado "${data.nome}" em ${imovel.titulo}`,
      dados: { imovel_id, status: data.status },
    });
    return jsonOk(data, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
