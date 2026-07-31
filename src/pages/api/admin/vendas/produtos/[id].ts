import type { APIRoute } from "astro";
import { requireAdminCookie, temPerfil, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao, excluirComLixeira } from "../../../../../lib/auditoria";

export const prerender = false;
const PERFIS = ["admin"];

const CAMPOS_EDITAVEIS = [
  "nome", "categoria", "custo", "preco_sugerido", "preco_ml", "preco_shopee",
  "em_estoque_trazpraca", "adicionado_trazpraca", "publicado_ml", "publicado_shopee",
  "ml_item_id", "shopee_item_id", "url_trazpraca", "imagem_url", "status", "observacoes",
] as const;

// PATCH → edita campos do produto (preço, status, flags de publicação, etc.)
export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const id = params.id as string;
    const b = await request.json();

    const patch: Record<string, unknown> = {};
    for (const campo of CAMPOS_EDITAVEIS) {
      if (b[campo] !== undefined) patch[campo] = b[campo];
    }
    if (Object.keys(patch).length === 0) return jsonErr(400, "Nada para atualizar.");
    patch.updated_at = new Date().toISOString();

    const db = supabaseAdmin();
    const { error } = await db.from("vendas_produtos").update(patch).eq("id", id);
    if (error) return jsonErr(400, error.message);

    await registrarAcao(db, { req: request, admin }, {
      acao: "editar", entidade: "vendas_produtos", registro_id: id,
      descricao: `Editou produto de Vendas (${Object.keys(patch).join(", ")})`, dados: patch,
    }).catch(() => {});

    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// DELETE → remove o produto (soft-delete, recuperável na Lixeira por 30 dias)
export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const id = params.id as string;

    const db = supabaseAdmin();
    const r = await excluirComLixeira(db, { req: request, admin }, {
      tabela: "vendas_produtos", id, entidade: "vendas_produtos",
      descricao: `Produto de Vendas ${id}`,
    });
    if (!r.ok) return jsonErr(400, r.error || "Falha ao excluir.");

    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
