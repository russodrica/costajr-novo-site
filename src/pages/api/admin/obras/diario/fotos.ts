import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { bloqueioSeSoLeitura } from "../../../../../lib/permissoes";

export const prerender = false;
const MODULO = "obras";

// POST /api/admin/obras/diario/fotos  { rdo_id, storage_path, nome_arquivo, legenda? }
// Registra no banco a foto que o navegador já subiu pela URL assinada.
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const bl = await bloqueioSeSoLeitura(admin, MODULO); if (bl) return bl;
    const db = supabaseAdmin();

    const b = await request.json().catch(() => null);
    const rdo_id = String(b?.rdo_id || "").trim();
    const storage_path = String(b?.storage_path || "").trim();
    if (!rdo_id || !storage_path) return jsonErr(400, "Dados da foto incompletos.");

    const { data: rdo } = await db.from("obras_rdo").select("id").eq("id", rdo_id).maybeSingle();
    if (!rdo) return jsonErr(404, "Relatório não encontrado.");

    // Mesmo arquivo registrado de novo (duplo toque no botão, reenvio da rede):
    // devolve o registro que já existe em vez de repetir a foto no relatório.
    const { data: ja } = await db.from("obras_rdo_fotos")
      .select("id, legenda, ordem").eq("storage_path", storage_path).maybeSingle();
    if (ja) return jsonOk(ja);

    // a foto nova entra no fim da galeria
    const { count } = await db.from("obras_rdo_fotos")
      .select("*", { count: "exact", head: true }).eq("rdo_id", rdo_id);

    const { data, error } = await db.from("obras_rdo_fotos").insert({
      rdo_id,
      storage_path,
      nome_arquivo: String(b?.nome_arquivo || "").slice(0, 200) || null,
      content_type: String(b?.content_type || "").slice(0, 100) || null,
      tamanho: Number(b?.tamanho) || null,
      legenda: String(b?.legenda || "").trim().slice(0, 300) || null,
      ordem: Number(count) || 0,
      criado_por: admin.email || null,
    }).select("id, legenda, ordem").single();
    if (error) {
      console.error("[rdo-fotos] insert falhou:", error.code, error.message, error.details);
      return jsonErr(400, "Não deu para registrar a foto.");
    }
    return jsonOk(data, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
