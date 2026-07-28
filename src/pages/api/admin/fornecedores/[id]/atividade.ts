import type { APIRoute } from "astro";
import { requireAdminCookie, temPerfil, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";

export const prerender = false;

// GET /api/admin/fornecedores/[id]/atividade → acessos (logins) + downloads do fornecedor.
// Fonte: audit_log filtrado pelo e-mail do fornecedor (login grava fornecedor_acesso;
// cada download grava fornecedor_download). Só admin.
export const GET: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, ["admin"])) return jsonErr(403, "Sem permissão");
    const db = supabaseAdmin();
    const { data: forn } = await db.from("portal_profiles")
      .select("id, email, display_name, empresa, last_login_at, approval_status")
      .eq("id", params.id!).eq("role", "fornecedor").maybeSingle();
    if (!forn) return jsonErr(404, "Fornecedor não encontrado.");

    const { data: logs } = await db.from("audit_log")
      .select("ts, entidade, descricao, ip")
      .eq("usuario_email", (forn as any).email)
      .in("entidade", ["fornecedor_acesso", "fornecedor_download"])
      .order("ts", { ascending: false })
      .limit(500);
    const all = (logs || []) as any[];
    const acessos = all.filter((l) => l.entidade === "fornecedor_acesso");
    const downloads = all.filter((l) => l.entidade === "fornecedor_download");
    return jsonOk({ fornecedor: forn, acessos, downloads, totalAcessos: acessos.length, totalDownloads: downloads.length });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
