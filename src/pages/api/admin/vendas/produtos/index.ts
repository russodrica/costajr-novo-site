import type { APIRoute } from "astro";
import { requireAdminCookie, temPerfil, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";

export const prerender = false;
const PERFIS = ["admin"]; // negócio pessoal da Adriana — só admin por enquanto

// GET → lista produtos do módulo Vendas, com filtro opcional por status/origem
export const GET: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const origem = url.searchParams.get("origem");

    const db = supabaseAdmin();
    let q = db.from("vendas_produtos").select("*").order("created_at", { ascending: false });
    if (status) q = q.eq("status", status);
    if (origem) q = q.eq("origem", origem);
    const { data, error } = await q;
    if (error) return jsonErr(400, error.message);
    return jsonOk({ produtos: data || [] });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// POST → adiciona um produto manualmente ao catálogo do módulo Vendas
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const b = await request.json();
    const nome = String(b.nome || "").trim();
    if (!nome) return jsonErr(400, "Informe o nome do produto.");

    const custo = b.custo != null ? Number(b.custo) : null;
    const precoSugerido = b.preco_sugerido != null ? Number(b.preco_sugerido) : null;
    if (custo != null && Number.isNaN(custo)) return jsonErr(400, "Custo inválido.");
    if (precoSugerido != null && Number.isNaN(precoSugerido)) return jsonErr(400, "Preço sugerido inválido.");

    const db = supabaseAdmin();
    const { data: row, error } = await db.from("vendas_produtos").insert({
      sku_trazpraca: b.sku_trazpraca ? String(b.sku_trazpraca).trim() : null,
      nome,
      categoria: b.categoria ? String(b.categoria).trim() : null,
      custo,
      preco_sugerido: precoSugerido,
      url_trazpraca: b.url_trazpraca ? String(b.url_trazpraca).trim() : null,
      imagem_url: b.imagem_url ? String(b.imagem_url).trim() : null,
      origem: "manual",
      status: "candidato",
      observacoes: b.observacoes ? String(b.observacoes).trim() : null,
      criado_por: admin.email,
    }).select("id").single();
    if (error) return jsonErr(400, error.message);

    await registrarAcao(db, { req: request, admin }, {
      acao: "criar", entidade: "vendas_produtos", registro_id: row?.id ?? null,
      descricao: `Adicionou produto "${nome}" ao catálogo de Vendas`,
    }).catch(() => {});

    return jsonOk({ ok: true, id: row?.id });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
