import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";
import { registrarAcao } from "../../../../lib/auditoria";
import { bloqueioSeSoLeitura, bloqueioSeSemLeitura } from "../../../../lib/permissoes";
import { TIPOS, TIPO_LABEL, limparCamposImovel, statusValidos } from "../../../../lib/negocios";

export const prerender = false;

// As 4 telas de Novos Negócios têm o MESMO público (admin + comercial), então o
// gate de permissão é o módulo "negocios" — a mesma key que o middleware deduz
// de /api/admin/negocios/... (ver moduloDaRotaApi em lib/permissoes.ts).
const MODULO = "negocios";

// GET /api/admin/negocios/imoveis?tipo=terreno&busca=...
export const GET: APIRoute = async ({ request, url }) => {
  try {
    const admin = await requireAdminCookie(request);
    const ro = await bloqueioSeSemLeitura(admin, MODULO); if (ro) return ro;
    const db = supabaseAdmin();

    const tipo = url.searchParams.get("tipo") || "";
    const busca = (url.searchParams.get("busca") || "").trim();
    let q = db.from("negocios_imoveis").select("*").order("created_at", { ascending: false }).limit(500);
    if (tipo) q = q.eq("tipo", tipo);
    if (busca) {
      const b = busca.replace(/[%,()]/g, " ").trim();
      q = q.or(`titulo.ilike.%${b}%,codigo.ilike.%${b}%,bairro.ilike.%${b}%,cidade.ilike.%${b}%,cliente_nome.ilike.%${b}%`);
    }
    const { data, error } = await q;
    if (error) return jsonErr(400, error.message);
    return jsonOk(data || []);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// POST /api/admin/negocios/imoveis  { tipo, titulo, ... }
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const bl = await bloqueioSeSoLeitura(admin, MODULO); if (bl) return bl;
    const db = supabaseAdmin();

    const body = await request.json().catch(() => null);
    if (!body) return jsonErr(400, "Envie os dados do cadastro.");

    const tipo = String(body.tipo || "").trim();
    if (!(TIPOS as readonly string[]).includes(tipo)) return jsonErr(400, "Tipo inválido.");

    const campos = limparCamposImovel(body);
    if (!campos.titulo) return jsonErr(400, "Informe o título (como o item aparece no catálogo).");
    // status: se não veio (ou veio de outro tipo), assume o primeiro da lista do tipo
    const validos = statusValidos(tipo);
    if (!campos.status || !validos.includes(campos.status)) campos.status = validos[0];

    const row = { ...campos, tipo, ativo: campos.ativo ?? true, criado_por: admin.email };
    const { data, error } = await db.from("negocios_imoveis").insert(row).select().single();
    if (error) return jsonErr(400, error.message);

    await registrarAcao(db, { req: request, admin }, {
      acao: "criar", entidade: "negocios_imoveis", registro_id: data.id,
      descricao: `Cadastrou ${TIPO_LABEL[tipo]}: ${data.titulo}`, dados: { tipo, status: data.status },
    });
    return jsonOk(data, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
