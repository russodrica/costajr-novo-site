import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";
import { bloqueioSeSoLeitura } from "../../../../../lib/permissoes";

export const prerender = false;

// GET /api/admin/rh/cargos?todos=1  → cargos (ativos por padrão)
export const GET: APIRoute = async ({ request, url }) => {
  try {
    await requireAdminCookie(request);
    const db = supabaseAdmin();
    let q = db.from("rh_cargos").select("*").order("ordem", { ascending: true }).order("nome", { ascending: true });
    if (url.searchParams.get("todos") !== "1") q = q.eq("ativo", true);
    const { data, error } = await q;
    if (error) return jsonErr(500, error.message);
    return jsonOk(data || []);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// POST /api/admin/rh/cargos  { nome, area? } → cria cargo
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const _ro = await bloqueioSeSoLeitura(admin, "recrutamento"); if (_ro) return _ro;
    const body = await request.json();
    const nome = String(body.nome || "").trim();
    if (!nome) return jsonErr(400, "Informe o nome do cargo.");
    const db = supabaseAdmin();
    const { data: max } = await db.from("rh_cargos").select("ordem").order("ordem", { ascending: false }).limit(1).maybeSingle();
    const row = { nome, area: body.area || null, ordem: (max?.ordem || 0) + 1 };
    const { data, error } = await db.from("rh_cargos").insert(row).select().single();
    if (error) return jsonErr(error.code === "23505" ? 409 : 400, error.code === "23505" ? "Já existe um cargo com esse nome." : error.message);
    await registrarAcao(db, { req: request, admin }, { acao: "criar", entidade: "rh_cargos", registro_id: data.id, descricao: `Cadastrou cargo "${nome}"`, dados: row });
    return jsonOk(data, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
