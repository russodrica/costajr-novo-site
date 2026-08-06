import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";
import { bloqueioSeSoLeitura } from "../../../../../lib/permissoes";
import { limparCamposOportunidade, FUNIL_VALORES, funilLabel } from "../../../../../lib/negocios";

export const prerender = false;

const MODULO = "negocios";

// PATCH /api/admin/negocios/oportunidades/[id] — usado tanto pelo formulário
// completo quanto pelo seletor rápido de status no card.
export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const bl = await bloqueioSeSoLeitura(admin, MODULO); if (bl) return bl;
    const db = supabaseAdmin();
    const id = params.id!;

    const { data: atual } = await db.from("negocios_oportunidades").select("*").eq("id", id).maybeSingle();
    if (!atual) return jsonErr(404, "Interessado não encontrado.");

    const body = await request.json().catch(() => null);
    if (!body) return jsonErr(400, "Envie os dados a alterar.");

    const campos = limparCamposOportunidade(body);
    if ("nome" in campos && !campos.nome) return jsonErr(400, "O nome não pode ficar em branco.");
    if (campos.status && !FUNIL_VALORES.includes(campos.status)) return jsonErr(400, "Status inválido.");
    if (!Object.keys(campos).length) return jsonErr(400, "Nada para alterar.");

    // "Fechado" carimba a data automaticamente; sair de fechado limpa.
    if (campos.status === "fechado" && !atual.fechado_em && !campos.fechado_em) {
      (campos as any).fechado_em = new Date().toISOString().slice(0, 10);
    }
    if (campos.status && campos.status !== "fechado") (campos as any).fechado_em = null;
    // qualquer mexida no interessado conta como contato de hoje, salvo se a tela mandou a data
    if (campos.status && !("ultimo_contato" in campos)) (campos as any).ultimo_contato = new Date().toISOString().slice(0, 10);

    (campos as any).updated_at = new Date().toISOString();
    const { data, error } = await db.from("negocios_oportunidades").update(campos).eq("id", id).select().single();
    if (error) return jsonErr(400, error.message);

    const mudouStatus = campos.status && campos.status !== atual.status;
    await registrarAcao(db, { req: request, admin }, {
      acao: "editar", entidade: "negocios_oportunidades", registro_id: id,
      descricao: mudouStatus
        ? `Interessado "${data.nome}": ${funilLabel(atual.status)} → ${funilLabel(data.status)}`
        : `Alterou interessado "${data.nome}"`,
      dados: campos,
    });
    return jsonOk(data);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// DELETE /api/admin/negocios/oportunidades/[id]
export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const bl = await bloqueioSeSoLeitura(admin, MODULO); if (bl) return bl;
    const db = supabaseAdmin();
    const id = params.id!;

    const { data: atual } = await db.from("negocios_oportunidades").select("*").eq("id", id).maybeSingle();
    if (!atual) return jsonErr(404, "Interessado não encontrado.");

    const { error } = await db.from("negocios_oportunidades").delete().eq("id", id);
    if (error) return jsonErr(400, error.message);

    await registrarAcao(db, { req: request, admin }, {
      acao: "excluir", entidade: "negocios_oportunidades", registro_id: id,
      descricao: `Removeu interessado "${atual.nome}"`, dados: { imovel_id: atual.imovel_id },
    });
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
