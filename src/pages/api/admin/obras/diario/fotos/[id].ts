import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../../lib/supabase";
import { bloqueioSeSoLeitura, bloqueioSeSemLeitura } from "../../../../../../lib/permissoes";
import { BUCKET_OBRAS, storageObras } from "../../../../../../lib/rdo";

export const prerender = false;
const MODULO = "obras";

// GET /api/admin/obras/diario/fotos/[id] — a foto em si.
// O bucket é privado: aqui assinamos uma URL de 10 minutos e redirecionamos.
// É assim que a tela mostra a imagem (<img src="/api/.../fotos/<id>">) sem
// deixar nenhuma foto de obra acessível por link solto.
export const GET: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const ro = await bloqueioSeSemLeitura(admin, MODULO); if (ro) return ro;
    const db = supabaseAdmin();

    const { data: foto } = await db.from("obras_rdo_fotos").select("storage_path").eq("id", params.id!).maybeSingle();
    if (!foto?.storage_path) return jsonErr(404, "Foto não encontrada.");

    const { data: assinada, error } = await storageObras().storage
      // 1 hora: o relatório fica aberto enquanto se preenche, e a impressão
      // precisa que as fotos ainda carreguem na hora de gerar o PDF.
      .from(BUCKET_OBRAS).createSignedUrl(foto.storage_path, 3600);
    if (error || !assinada?.signedUrl) return jsonErr(500, error?.message || "Falha ao abrir a foto.");

    return new Response(null, {
      status: 302,
      headers: { location: assinada.signedUrl, "cache-control": "private, max-age=1800" },
    });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// PATCH /api/admin/obras/diario/fotos/[id]  { legenda?, ordem? }
export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const bl = await bloqueioSeSoLeitura(admin, MODULO); if (bl) return bl;
    const db = supabaseAdmin();

    const b = await request.json().catch(() => null);
    if (!b) return jsonErr(400, "Envie o que alterar.");
    const patch: Record<string, unknown> = {};
    if (b.legenda !== undefined) patch.legenda = String(b.legenda || "").trim().slice(0, 300) || null;
    if (b.ordem !== undefined) patch.ordem = Math.max(0, Math.round(Number(b.ordem) || 0));
    if (!Object.keys(patch).length) return jsonErr(400, "Nada para alterar.");

    const { error } = await db.from("obras_rdo_fotos").update(patch).eq("id", params.id!);
    if (error) return jsonErr(400, error.message);
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// DELETE /api/admin/obras/diario/fotos/[id]
export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const bl = await bloqueioSeSoLeitura(admin, MODULO); if (bl) return bl;
    const db = supabaseAdmin();

    const { data: foto } = await db.from("obras_rdo_fotos").select("storage_path").eq("id", params.id!).maybeSingle();
    if (!foto) return jsonErr(404, "Foto não encontrada.");

    const { error } = await db.from("obras_rdo_fotos").delete().eq("id", params.id!);
    if (error) return jsonErr(400, error.message);
    // arquivo no bucket: best-effort, o registro já saiu
    try { await storageObras().storage.from(BUCKET_OBRAS).remove([foto.storage_path]); } catch { /* ok */ }
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
