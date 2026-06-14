import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { excluirComLixeira, registrarAcao } from "../../../../../lib/auditoria";

export const prerender = false;

const CAMPOS = [
  "disciplina", "macrogrupo", "grupo", "descricao", "unidade",
  "custo_material", "custo_mao_obra", "fonte", "status_auditoria",
  "sinapi_codigo", "sinapi_preco", "sinapi_data", "valor_referencia",
  "observacoes", "ativo", "data_atualizacao",
];
const NUMERICOS = new Set(["custo_material", "custo_mao_obra", "sinapi_preco", "valor_referencia"]);

// PATCH /api/admin/orcamentos/servicos/[codigo]
export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const body = await request.json();
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const c of CAMPOS) {
      if (body[c] === undefined) continue;
      if (body[c] === "" && c !== "status_auditoria") { patch[c] = null; continue; }
      patch[c] = NUMERICOS.has(c) ? Number(body[c]) : body[c];
    }
    const db = supabaseAdmin();
    const { data, error } = await db.from("orc_servicos").update(patch).eq("codigo", params.codigo!).select().single();
    if (error) return jsonErr(400, error.message);
    if (!data) return jsonErr(404, "Serviço não encontrado");
    await registrarAcao(db, { req: request, admin }, { acao: "editar", entidade: "orc_servicos", registro_id: params.codigo!, descricao: `Editou serviço "${data.descricao || params.codigo}"`, dados: patch });
    return jsonOk(data);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// DELETE /api/admin/orcamentos/servicos/[codigo]?hard=1
//   Padrão: desativa (ativo=false), preservando histórico. hard=1 apaga de vez.
export const DELETE: APIRoute = async ({ request, params, url }) => {
  try {
    const admin = await requireAdminCookie(request);
    const codigo = params.codigo!;
    const db = supabaseAdmin();
    const { data: svc } = await db.from("orc_servicos").select("descricao").eq("codigo", codigo).maybeSingle();
    const nome = svc?.descricao ? `serviço "${svc.descricao}"` : `serviço ${codigo}`;
    if (url.searchParams.get("hard") === "1") {
      const r = await excluirComLixeira(db, { req: request, admin }, {
        tabela: "orc_servicos", id: codigo, idCol: "codigo", entidade: "orc_servicos",
        descricao: `Excluiu ${nome}`,
      });
      if (!r.ok) return jsonErr(400, r.error || "Falha ao excluir");
      return jsonOk({ ok: true, apagado: true });
    }
    const { data, error } = await db.from("orc_servicos")
      .update({ ativo: false, updated_at: new Date().toISOString() })
      .eq("codigo", codigo).select().single();
    if (error) return jsonErr(400, error.message);
    if (!data) return jsonErr(404, "Serviço não encontrado");
    await registrarAcao(db, { req: request, admin }, { acao: "excluir", entidade: "orc_servicos", registro_id: codigo, descricao: `Desativou ${nome}` });
    return jsonOk({ ok: true, desativado: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
