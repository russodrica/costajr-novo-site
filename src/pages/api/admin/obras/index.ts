import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../lib/auth";
import { bloqueioSeSoLeitura } from "../../../../lib/permissoes";
import { supabaseAdmin } from "../../../../lib/supabase";
import { registrarAcao } from "../../../../lib/auditoria";

export const prerender = false;

// GET /api/admin/obras?status=&busca=
export const GET: APIRoute = async ({ request, url }) => {
  try {
    await requireAdminCookie(request);
    const db = supabaseAdmin();
    let q = db.from("obras").select("*").order("created_at", { ascending: false }).limit(500);
    const status = url.searchParams.get("status");
    const busca = url.searchParams.get("busca");
    if (status && status !== "todas") q = q.eq("status", status);
    if (busca) {
      const b = busca.replace(/[%,()]/g, " ").trim();
      q = q.or(`nome.ilike.%${b}%,codigo.ilike.%${b}%,cliente.ilike.%${b}%,cidade.ilike.%${b}%`);
    }
    const { data, error } = await q;
    if (error) return jsonErr(500, error.message);
    return jsonOk(data || []);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// POST /api/admin/obras
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const _ro = await bloqueioSeSoLeitura(admin, "obras"); if (_ro) return _ro;
    const body = await request.json();
    if (!body.nome) return jsonErr(400, "Nome da obra é obrigatório");
    const campos = ["nome", "codigo", "cliente", "endereco", "cidade", "uf", "status", "data_inicio", "data_fim_prevista", "data_fim_real", "responsavel_nome", "valor_contrato", "observacoes"];
    const row: Record<string, unknown> = { criado_por: admin.email };
    for (const c of campos) if (body[c] !== undefined && body[c] !== "") row[c] = body[c];
    const db = supabaseAdmin();
    const { data, error } = await db.from("obras").insert(row).select().single();
    if (error) return jsonErr(400, error.message);
    await registrarAcao(db, { req: request, admin }, {
      acao: "criar",
      entidade: "obras",
      registro_id: data?.id ?? null,
      descricao: `Criou obra "${data?.nome ?? body.nome}"`,
      dados: data,
    });
    return jsonOk(data, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
