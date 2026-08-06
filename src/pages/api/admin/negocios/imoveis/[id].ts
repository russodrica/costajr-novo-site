import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";
import { bloqueioSeSoLeitura } from "../../../../../lib/permissoes";
import {
  limparCamposImovel, statusValidos, TIPO_LABEL,
  BUCKET_NEGOCIOS, storageNegocios,
} from "../../../../../lib/negocios";

export const prerender = false;

const MODULO = "negocios";

// PATCH /api/admin/negocios/imoveis/[id]
export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const bl = await bloqueioSeSoLeitura(admin, MODULO); if (bl) return bl;
    const db = supabaseAdmin();
    const id = params.id!;

    const { data: atual } = await db.from("negocios_imoveis").select("*").eq("id", id).maybeSingle();
    if (!atual) return jsonErr(404, "Cadastro não encontrado.");

    const body = await request.json().catch(() => null);
    if (!body) return jsonErr(400, "Envie os dados a alterar.");

    const campos = limparCamposImovel(body);
    if ("titulo" in campos && !campos.titulo) return jsonErr(400, "O título não pode ficar em branco.");
    if (campos.status && !statusValidos(atual.tipo).includes(campos.status)) {
      return jsonErr(400, "Situação inválida para este tipo de cadastro.");
    }
    // capa: só aceita um anexo que seja FOTO DESTE imóvel (senão dá para apontar
    // a capa para o arquivo de outro registro)
    if ("capa_anexo_id" in body) {
      const capa = String(body.capa_anexo_id || "") || null;
      if (capa) {
        const { data: ax } = await db.from("negocios_anexos").select("id").eq("id", capa).eq("imovel_id", id).eq("especie", "foto").maybeSingle();
        if (!ax) return jsonErr(400, "Foto de capa inválida.");
      }
      (campos as any).capa_anexo_id = capa;
    }
    if (!Object.keys(campos).length) return jsonErr(400, "Nada para alterar.");

    (campos as any).updated_at = new Date().toISOString();
    const { data, error } = await db.from("negocios_imoveis").update(campos).eq("id", id).select().single();
    if (error) return jsonErr(400, error.message);

    await registrarAcao(db, { req: request, admin }, {
      acao: "editar", entidade: "negocios_imoveis", registro_id: id,
      descricao: `Alterou ${TIPO_LABEL[atual.tipo]}: ${data.titulo}`, dados: campos,
    });
    return jsonOk(data);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// DELETE /api/admin/negocios/imoveis/[id] — apaga o card, os arquivos e os interessados.
// É definitivo, por isso a tela pede confirmação digitada.
export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const bl = await bloqueioSeSoLeitura(admin, MODULO); if (bl) return bl;
    const db = supabaseAdmin();
    const id = params.id!;

    const { data: atual } = await db.from("negocios_imoveis").select("*").eq("id", id).maybeSingle();
    if (!atual) return jsonErr(404, "Cadastro não encontrado.");

    // remove os arquivos do storage antes (o banco cascateia as linhas)
    const { data: anexos } = await db.from("negocios_anexos").select("storage_path").eq("imovel_id", id);
    const paths = (anexos || []).map((a: any) => a.storage_path).filter(Boolean);
    if (paths.length) {
      try { await storageNegocios().storage.from(BUCKET_NEGOCIOS).remove(paths); } catch { /* best-effort */ }
    }

    const { error } = await db.from("negocios_imoveis").delete().eq("id", id);
    if (error) return jsonErr(400, error.message);

    await registrarAcao(db, { req: request, admin }, {
      acao: "excluir", entidade: "negocios_imoveis", registro_id: id,
      descricao: `Excluiu ${TIPO_LABEL[atual.tipo]}: ${atual.titulo}`,
      dados: { arquivos_removidos: paths.length },
    });
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
