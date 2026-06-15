import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { enviarTelegram, escTg } from "../../../../../lib/telegram";
import { bloqueioSeSoLeitura } from "../../../../../lib/permissoes";

export const prerender = false;

// GET /api/admin/ativos/[id] — detalhe com histórico completo
export const GET: APIRoute = async ({ request, params }) => {
  try {
    await requireAdminCookie(request);
    const id = params.id!;
    const db = supabaseAdmin();

    const [{ data: ativo, error }, { data: movimentos }, { data: termos }, { data: manutencoes }, { data: ocorrencias }] = await Promise.all([
      db.from("ativos").select("*").eq("id", id).maybeSingle(),
      db.from("ativos_movimentos").select("*").eq("ativo_id", id).order("created_at", { ascending: false }).limit(500),
      db.from("ativos_termos").select("*").eq("ativo_id", id).order("created_at", { ascending: false }).limit(200),
      db.from("ativos_manutencoes").select("*").eq("ativo_id", id).order("created_at", { ascending: false }).limit(200),
      db.from("ativos_ocorrencias").select("*").eq("ativo_id", id).order("created_at", { ascending: false }).limit(200),
    ]);
    if (error) return jsonErr(500, error.message);
    if (!ativo) return jsonErr(404, "Ativo não encontrado");

    return jsonOk({ ativo, movimentos: movimentos || [], termos: termos || [], manutencoes: manutencoes || [], ocorrencias: ocorrencias || [] });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// PATCH /api/admin/ativos/[id] — edita dados cadastrais (gera movimento de edição)
export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const _ro = await bloqueioSeSoLeitura(admin, "ativos"); if (_ro) return _ro;
    const id = params.id!;
    const body = await request.json();

    const editaveis = [
      "codigo_interno", "numero_patrimonial", "categoria", "subcategoria", "descricao",
      "marca", "modelo", "fabricante", "numero_serie", "data_aquisicao", "valor_aquisicao",
      "fornecedor", "observacoes", "nota_fiscal_url", "numero_nota_fiscal", "data_nota_fiscal",
      "garantia", "garantia_fim", "manual_url", "fotos", "anexos", "campos",
    ];
    if (body.categoria !== undefined && !["telefonia", "informatica", "equipamento_obra", "epi", "veiculo", "mobiliario", "outros"].includes(body.categoria)) {
      return jsonErr(400, "Categoria inválida");
    }
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const c of editaveis) if (body[c] !== undefined) patch[c] = body[c] === "" ? null : body[c];
    if (Object.keys(patch).length <= 1) return jsonErr(400, "Nada para atualizar");

    const db = supabaseAdmin();
    const { data, error } = await db.from("ativos").update(patch).eq("id", id).select().single();
    if (error) return jsonErr(400, error.message);

    await db.from("ativos_movimentos").insert({
      ativo_id: id,
      tipo: "edicao",
      descricao: "Dados cadastrais alterados",
      dados: { campos_alterados: Object.keys(patch).filter(k => k !== "updated_at") },
      feito_por: admin.email,
    });

    enviarTelegram(`✏️ <b>Ativo editado</b>\n${escTg(data.descricao)}${data.numero_patrimonial ? ` (pat. ${escTg(data.numero_patrimonial)})` : ""}\nCampos: ${escTg(Object.keys(patch).filter(k => k !== "updated_at").join(", "))}\nPor ${escTg(admin.email)}`).catch(() => { /* best-effort */ });

    return jsonOk(data);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
