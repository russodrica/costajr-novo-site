import type { APIRoute } from "astro";
import { requireAdminCookie, temPerfil, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";
import { registrarAcao } from "../../../../lib/auditoria";

export const prerender = false;

// Documentos da Empresa: acesso restrito a admin + financeiro + jurídico.
const PERFIS = ["admin", "financeiro", "juridico"];

// GET /api/admin/doc-empresa?categoria=...&arquivados=1 → lista com anexos
export const GET: APIRoute = async ({ request, url }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const db = supabaseAdmin();
    let q = db
      .from("doc_empresa")
      .select("*, doc_empresa_arquivos(id,nome,storage_path,created_at)")
      .order("categoria")
      .order("nome");
    if (url.searchParams.get("arquivados") !== "1") q = q.eq("arquivado", false);
    const cat = url.searchParams.get("categoria");
    if (cat) q = q.eq("categoria", cat);
    const { data, error } = await q;
    if (error) return jsonErr(500, error.message);
    return jsonOk(data || []);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// POST /api/admin/doc-empresa → cria documento
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const body = await request.json();
    const nome = String(body.nome || "").trim();
    if (!nome) return jsonErr(400, "Informe o nome do documento.");
    const categoria = String(body.categoria || "").trim() || "Documentos Diversos";

    const validade_na = body.validade_na === true || body.validade_na === "true" || body.validade_na === "on";
    const validade = validade_na ? null : (String(body.validade || "").trim() || null);

    const row: Record<string, unknown> = {
      nome,
      categoria,
      grupo: categoria === "Documento Fiscal" ? (String(body.grupo || "").trim() || "Diversos") : null,
      validade_na,
      validade,
      periodicidade: String(body.periodicidade || "").trim() || null,
      site: String(body.site || "").trim() || null,
      observacoes: String(body.observacoes || "").trim() || null,
      criado_por: admin.email,
    };

    const db = supabaseAdmin();
    const { data, error } = await db.from("doc_empresa").insert(row).select().single();
    if (error) return jsonErr(400, error.message);
    await registrarAcao(db, { req: request, admin }, {
      acao: "criar", entidade: "doc_empresa", registro_id: data.id,
      descricao: `Criou o documento "${data.nome}" (${data.categoria})`, dados: data,
    });
    return jsonOk(data, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
