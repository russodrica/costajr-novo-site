import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";
import { bloqueioSeSoLeitura, bloqueioSeSemLeitura } from "../../../../../lib/permissoes";
import { BUCKET_NEGOCIOS, storageNegocios } from "../../../../../lib/negocios";

export const prerender = false;

const MODULO = "negocios";

// GET /api/admin/negocios/anexos/[id] — arquivo do bucket PRIVADO.
// Redireciona para uma URL assinada de 10 min. É por aqui que a tela mostra as
// fotos do catálogo (<img src="/api/admin/negocios/anexos/<id>">) — nada fica
// público, então uma foto não vaza por link solto.
export const GET: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const ro = await bloqueioSeSemLeitura(admin, MODULO); if (ro) return ro;
    const db = supabaseAdmin();

    const { data: anexo } = await db.from("negocios_anexos").select("*").eq("id", params.id!).maybeSingle();
    if (!anexo?.storage_path) return jsonErr(404, "Arquivo não encontrado.");

    const { data: assinada, error } = await storageNegocios().storage
      .from(BUCKET_NEGOCIOS).createSignedUrl(anexo.storage_path, 600);
    if (error || !assinada?.signedUrl) return jsonErr(500, error?.message || "Falha ao abrir o arquivo.");

    return new Response(null, {
      status: 302,
      headers: { location: assinada.signedUrl, "cache-control": "private, max-age=300" },
    });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// DELETE /api/admin/negocios/anexos/[id]
export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const bl = await bloqueioSeSoLeitura(admin, MODULO); if (bl) return bl;
    const db = supabaseAdmin();
    const id = params.id!;

    const { data: anexo } = await db.from("negocios_anexos").select("*").eq("id", id).maybeSingle();
    if (!anexo) return jsonErr(404, "Arquivo não encontrado.");

    const { error } = await db.from("negocios_anexos").delete().eq("id", id);
    if (error) return jsonErr(400, error.message);
    try { await storageNegocios().storage.from(BUCKET_NEGOCIOS).remove([anexo.storage_path]); } catch { /* best-effort */ }

    // se era a capa, promove a próxima foto (o card não fica sem imagem à toa)
    const { data: imovel } = await db.from("negocios_imoveis").select("id, capa_anexo_id").eq("id", anexo.imovel_id).maybeSingle();
    if (imovel && imovel.capa_anexo_id === id) {
      const { data: prox } = await db.from("negocios_anexos")
        .select("id").eq("imovel_id", anexo.imovel_id).eq("especie", "foto").order("created_at").limit(1).maybeSingle();
      await db.from("negocios_imoveis")
        .update({ capa_anexo_id: prox?.id || null, updated_at: new Date().toISOString() })
        .eq("id", anexo.imovel_id);
    }

    await registrarAcao(db, { req: request, admin }, {
      acao: "excluir", entidade: "negocios_anexos", registro_id: id,
      descricao: `Removeu ${anexo.especie === "foto" ? "foto" : "documento"} "${anexo.titulo || anexo.nome_arquivo}"`,
      dados: { imovel_id: anexo.imovel_id },
    });
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
