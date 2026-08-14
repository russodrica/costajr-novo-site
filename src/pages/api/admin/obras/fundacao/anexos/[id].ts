import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../../lib/supabase";
import { registrarAcao } from "../../../../../../lib/auditoria";
import { bloqueioSeSoLeitura, bloqueioSeSemLeitura } from "../../../../../../lib/permissoes";
import { BUCKET_OBRAS, storageObras } from "../../../../../../lib/rdo";

export const prerender = false;
const MODULO = "obras";

// GET /api/admin/obras/fundacao/anexos/[id]
// Entrega o PDF do histórico. Servido pelo portal: abre com o nome certo,
// continua protegido pelo login e nenhum endereço de arquivo circula solto.
export const GET: APIRoute = async ({ request, params, url }) => {
  try {
    const admin = await requireAdminCookie(request);
    const ro = await bloqueioSeSemLeitura(admin, MODULO); if (ro) return ro;
    const db = supabaseAdmin();

    const { data: anexo } = await db.from("obras_fundacao_anexos")
      .select("storage_path, nome_arquivo, content_type").eq("id", params.id!).maybeSingle();
    if (!anexo) return jsonErr(404, "Arquivo não encontrado.");

    const { data: assinada, error } = await storageObras().storage
      .from(BUCKET_OBRAS).createSignedUrl(anexo.storage_path, 600);
    if (error || !assinada?.signedUrl) return jsonErr(500, error?.message || "Falha ao abrir o arquivo.");

    const arquivo = await fetch(assinada.signedUrl);
    if (!arquivo.ok) return jsonErr(502, "Não deu para ler o arquivo no depósito.");

    const nome = (anexo.nome_arquivo || "relatorio.pdf").replace(/["\\]/g, "");
    return new Response(arquivo.body, {
      headers: {
        "content-type": anexo.content_type || "application/pdf",
        "content-disposition": `${url.searchParams.get("baixar") ? "attachment" : "inline"}; filename="${nome}"`,
        "cache-control": "private, max-age=600",
      },
    });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// DELETE /api/admin/obras/fundacao/anexos/[id]
export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const bl = await bloqueioSeSoLeitura(admin, MODULO); if (bl) return bl;
    const db = supabaseAdmin();

    const { data: anexo } = await db.from("obras_fundacao_anexos")
      .select("id, storage_path, nome_arquivo").eq("id", params.id!).maybeSingle();
    if (!anexo) return jsonErr(404, "Arquivo não encontrado.");

    const { error } = await db.from("obras_fundacao_anexos").delete().eq("id", params.id!);
    if (error) return jsonErr(400, error.message);
    try { await storageObras().storage.from(BUCKET_OBRAS).remove([anexo.storage_path]); } catch { /* o registro já saiu */ }

    await registrarAcao(db, { req: request, admin }, {
      acao: "excluir", entidade: "obras_fundacao_anexos", registro_id: params.id!,
      descricao: `Histórico removido — ${anexo.nome_arquivo || anexo.storage_path}`,
    });
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
