import type { APIRoute } from "astro";
import { requireAdminCookie, jsonErr } from "../../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../../lib/supabase";
import { bloqueioSeSemLeitura } from "../../../../../../lib/permissoes";
import { BUCKET_OBRAS, storageObras } from "../../../../../../lib/rdo";

export const prerender = false;
const MODULO = "obras-diario";

// GET /api/admin/obras/diario/pdf/[id]
//
// Entrega o PDF ORIGINAL do relatório antigo — o documento que já foi emitido
// e enviado ao cliente no sistema anterior.
//
// O arquivo é servido pelo próprio portal (e não por link do depósito): assim
// ele abre com o nome certo, continua protegido pelo login e nenhum endereço de
// arquivo circula solto.
export const GET: APIRoute = async ({ request, params, url }) => {
  try {
    const admin = await requireAdminCookie(request);
    const ro = await bloqueioSeSemLeitura(admin, MODULO); if (ro) return ro;
    const db = supabaseAdmin();

    const { data: rdo } = await db.from("obras_rdo")
      .select("pdf_path, pdf_nome").eq("id", params.id!).maybeSingle();
    if (!rdo?.pdf_path) return jsonErr(404, "Este relatório não tem PDF original.");

    const { data: assinada, error } = await storageObras().storage
      .from(BUCKET_OBRAS).createSignedUrl(rdo.pdf_path, 600);
    if (error || !assinada?.signedUrl) return jsonErr(500, error?.message || "Falha ao abrir o PDF.");

    const arquivo = await fetch(assinada.signedUrl);
    if (!arquivo.ok) return jsonErr(502, "Não deu para ler o PDF no depósito.");

    // ?baixar=1 força o download; sem isso abre no visualizador do navegador
    const baixar = url.searchParams.get("baixar");
    const nome = (rdo.pdf_nome || "relatorio.pdf").replace(/["\\]/g, "");
    return new Response(arquivo.body, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `${baixar ? "attachment" : "inline"}; filename="${nome}"`,
        "cache-control": "private, max-age=600",
      },
    });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
