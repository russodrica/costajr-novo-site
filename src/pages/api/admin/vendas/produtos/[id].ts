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
  // Campos da ficha. Entraram na lista porque a ficha pode ser CONTAMINADA por
  // uma fonte errada (SKU repetido em anúncio da Shopee, página trocada na
  // vitrine) e aí é preciso poder limpar o estrago sem migration e com rastro
  // na auditoria. Quem edita aqui é sempre admin, e toda edição fica logada.
  "fotos", "descricao", "marca", "titulo_anuncio",
  "peso_kg", "altura_cm", "largura_cm", "profundidade_cm",
  "shopee_situacao", "pronto_para_publicar", "pendencias",
  // A ficha de características (pares nome→valor) alimenta os atributos do
  // ML — é por aqui que se responde "Cor", "Material", "Tipo de alimentação"
  // quando o nome do produto não diz e a foto sim.
  "caracteristicas",
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
