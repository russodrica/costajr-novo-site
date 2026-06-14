import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";
import { registrarAcao } from "../../../../lib/auditoria";
import { enviarTelegram, escTg } from "../../../../lib/telegram";

export const prerender = false;

const CATEGORIAS_VALIDAS = ["telefonia", "informatica", "equipamento_obra", "epi", "veiculo", "mobiliario", "outros"];

// GET /api/admin/ativos?categoria=&status=&busca=&alocado_tipo=&alocado_id=
export const GET: APIRoute = async ({ request, url }) => {
  try {
    await requireAdminCookie(request);
    const db = supabaseAdmin();
    let q = db.from("ativos").select("*").order("created_at", { ascending: false }).limit(1000);

    const categoria = url.searchParams.get("categoria");
    const status = url.searchParams.get("status");
    const busca = url.searchParams.get("busca");
    const alocadoTipo = url.searchParams.get("alocado_tipo");
    const alocadoId = url.searchParams.get("alocado_id");

    if (categoria && categoria !== "todas") q = q.eq("categoria", categoria);
    if (status && status !== "todos") q = q.eq("status", status);
    if (alocadoTipo) q = q.eq("alocado_para_tipo", alocadoTipo);
    if (alocadoId) q = q.eq("alocado_para_id", alocadoId);
    if (busca) {
      const b = busca.replace(/[%,()]/g, " ").trim();
      q = q.or(`descricao.ilike.%${b}%,marca.ilike.%${b}%,modelo.ilike.%${b}%,numero_serie.ilike.%${b}%,numero_patrimonial.ilike.%${b}%,codigo_interno.ilike.%${b}%,alocado_para_nome.ilike.%${b}%`);
    }

    const { data, error } = await q;
    if (error) return jsonErr(500, error.message);
    return jsonOk(data || []);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// POST /api/admin/ativos — cria ativo + movimento de cadastro
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const body = await request.json();
    const { categoria, descricao } = body;
    if (!categoria || !descricao) return jsonErr(400, "Categoria e descrição são obrigatórios");
    if (!CATEGORIAS_VALIDAS.includes(categoria)) return jsonErr(400, "Categoria inválida");

    // status NÃO é aceito do cliente: todo ativo novo nasce em estoque
    const campos = [
      "codigo_interno", "numero_patrimonial", "categoria", "subcategoria", "descricao",
      "marca", "modelo", "fabricante", "numero_serie", "data_aquisicao", "valor_aquisicao",
      "fornecedor", "observacoes", "nota_fiscal_url", "numero_nota_fiscal", "data_nota_fiscal",
      "garantia", "garantia_fim", "manual_url", "fotos", "anexos", "campos",
    ];
    const row: Record<string, unknown> = { criado_por: admin.email, status: "em_estoque" };
    for (const c of campos) if (body[c] !== undefined && body[c] !== "") row[c] = body[c];

    const db = supabaseAdmin();
    const { data, error } = await db.from("ativos").insert(row).select().single();
    if (error) return jsonErr(400, error.message);

    await db.from("ativos_movimentos").insert({
      ativo_id: data.id,
      tipo: "cadastro",
      descricao: "Ativo cadastrado no sistema",
      status_novo: data.status,
      feito_por: admin.email,
    });

    enviarTelegram(`🆕 <b>Ativo cadastrado</b>\n${escTg(data.descricao)}${data.numero_patrimonial ? ` (pat. ${escTg(data.numero_patrimonial)})` : ""}\nCategoria: ${escTg(data.categoria)}\nPor ${escTg(admin.email)}`).catch(() => { /* best-effort */ });

    await registrarAcao(db, { req: request, admin }, {
      acao: "criar",
      entidade: "ativos",
      registro_id: data.id,
      descricao: `Criou ativo "${data.descricao}" (${data.categoria})`,
      dados: data,
    });

    return jsonOk(data, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
