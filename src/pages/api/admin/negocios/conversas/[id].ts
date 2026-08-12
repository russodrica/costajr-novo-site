import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";
import { bloqueioSeSoLeitura } from "../../../../../lib/permissoes";
import { BUCKET_NEGOCIOS, storageNegocios } from "../../../../../lib/negocios";

export const prerender = false;

const MODULO = "negocios";

// PATCH /api/admin/negocios/conversas/[id]  { texto?, data? }
export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const bl = await bloqueioSeSoLeitura(admin, MODULO); if (bl) return bl;
    const db = supabaseAdmin();
    const id = params.id!;

    const { data: atual } = await db.from("negocios_conversas").select("*").eq("id", id).maybeSingle();
    if (!atual) return jsonErr(404, "Anotação não encontrada.");

    const body = await request.json().catch(() => null);
    if (!body) return jsonErr(400, "Envie os dados a alterar.");
    const patch: Record<string, unknown> = {};
    if (body.texto !== undefined) {
      const t = String(body.texto || "").trim();
      if (!t) return jsonErr(400, "O texto não pode ficar vazio.");
      patch.texto = t;
    }
    if (body.data !== undefined) {
      const d = String(body.data || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return jsonErr(400, "Data inválida.");
      patch.data = d;
    }
    if (!Object.keys(patch).length) return jsonErr(400, "Nada para alterar.");
    // o autor original NUNCA muda — é o registro de quem escreveu
    patch.updated_at = new Date().toISOString();

    const { data, error } = await db.from("negocios_conversas").update(patch).eq("id", id).select().single();
    if (error) return jsonErr(400, error.message);

    await registrarAcao(db, { req: request, admin }, {
      acao: "editar", entidade: "negocios_conversas", registro_id: id,
      descricao: `Editou uma anotação do histórico`, dados: patch,
    });
    return jsonOk(data);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// DELETE /api/admin/negocios/conversas/[id] — leva junto os prints da anotação.
export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const bl = await bloqueioSeSoLeitura(admin, MODULO); if (bl) return bl;
    const db = supabaseAdmin();
    const id = params.id!;

    const { data: atual } = await db.from("negocios_conversas").select("*").eq("id", id).maybeSingle();
    if (!atual) return jsonErr(404, "Anotação não encontrada.");

    const { data: anexos } = await db.from("negocios_anexos").select("storage_path").eq("conversa_id", id);
    const paths = (anexos || []).map((a: any) => a.storage_path).filter(Boolean);

    const { error } = await db.from("negocios_conversas").delete().eq("id", id);
    if (error) return jsonErr(400, error.message);
    if (paths.length) {
      try { await storageNegocios().storage.from(BUCKET_NEGOCIOS).remove(paths); } catch { /* best-effort */ }
    }

    await registrarAcao(db, { req: request, admin }, {
      acao: "excluir", entidade: "negocios_conversas", registro_id: id,
      descricao: `Removeu uma anotação do histórico`, dados: { imovel_id: atual.imovel_id, prints: paths.length },
    });
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
