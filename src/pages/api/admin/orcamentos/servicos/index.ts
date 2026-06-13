import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";

export const prerender = false;

const CAMPOS = [
  "codigo", "disciplina", "macrogrupo", "grupo", "descricao", "unidade",
  "custo_material", "custo_mao_obra", "fonte", "status_auditoria",
  "sinapi_codigo", "sinapi_preco", "sinapi_data", "valor_referencia",
  "observacoes", "ativo", "data_atualizacao",
];
const NUMERICOS = new Set(["custo_material", "custo_mao_obra", "sinapi_preco", "valor_referencia"]);

// GET /api/admin/orcamentos/servicos?disciplina=&grupo=&status=&busca=&ativo=&page=&pageSize=
export const GET: APIRoute = async ({ request, url }) => {
  try {
    await requireAdminCookie(request);
    const db = supabaseAdmin();
    const sp = url.searchParams;

    const page = Math.max(1, parseInt(sp.get("page") || "1", 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(sp.get("pageSize") || "50", 10) || 50));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let q = db.from("orc_servicos").select("*", { count: "exact" });

    const disciplina = sp.get("disciplina");
    const grupo = sp.get("grupo");
    const status = sp.get("status");
    const ativo = sp.get("ativo");
    const busca = sp.get("busca");

    if (disciplina && disciplina !== "todas") q = q.eq("disciplina", disciplina);
    if (grupo && grupo !== "todos") q = q.eq("grupo", grupo);
    if (status === "pendentes") q = q.neq("status_auditoria", "OK");
    else if (status && status !== "todos") q = q.eq("status_auditoria", status);
    if (ativo === "ativos") q = q.eq("ativo", true);
    else if (ativo === "inativos") q = q.eq("ativo", false);
    if (busca) {
      const b = busca.replace(/[%,()]/g, " ").trim();
      if (b) q = q.or(`codigo.ilike.%${b}%,descricao.ilike.%${b}%,grupo.ilike.%${b}%`);
    }

    q = q.order("disciplina").order("grupo").order("codigo").range(from, to);
    const { data, error, count } = await q;
    if (error) return jsonErr(500, error.message);
    return jsonOk({ itens: data || [], total: count ?? 0, page, pageSize });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// POST /api/admin/orcamentos/servicos  (novo serviço)
export const POST: APIRoute = async ({ request }) => {
  try {
    await requireAdminCookie(request);
    const body = await request.json();
    if (!body.codigo || !String(body.codigo).trim()) return jsonErr(400, "Código é obrigatório");
    if (!body.descricao || !String(body.descricao).trim()) return jsonErr(400, "Descrição é obrigatória");
    if (!body.disciplina) return jsonErr(400, "Disciplina é obrigatória");

    const row: Record<string, unknown> = { status_auditoria: "OK", ativo: true };
    for (const c of CAMPOS) {
      if (body[c] === undefined || body[c] === "") continue;
      row[c] = NUMERICOS.has(c) ? Number(body[c]) : body[c];
    }
    row.codigo = String(body.codigo).trim();

    const db = supabaseAdmin();
    const { data, error } = await db.from("orc_servicos").insert(row).select().single();
    if (error) {
      if (error.code === "23505") return jsonErr(409, `Código "${row.codigo}" já existe na base.`);
      return jsonErr(400, error.message);
    }
    return jsonOk(data, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
