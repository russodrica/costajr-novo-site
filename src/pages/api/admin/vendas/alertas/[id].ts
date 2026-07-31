import type { APIRoute } from "astro";
import { requireAdminCookie, temPerfil, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";

export const prerender = false;
const PERFIS = ["admin"];

// PATCH { acao: "resolver" } → marca o alerta como resolvido
export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const id = params.id as string;
    const b = await request.json().catch(() => ({}));
    if (b.acao !== "resolver") return jsonErr(400, "Ação inválida.");

    const db = supabaseAdmin();
    const { error } = await db.from("vendas_alertas").update({
      resolvido: true, resolvido_por: admin.email, resolvido_em: new Date().toISOString(),
    }).eq("id", id);
    if (error) return jsonErr(400, error.message);

    await registrarAcao(db, { req: request, admin }, {
      acao: "editar", entidade: "vendas_alertas", registro_id: id,
      descricao: `Resolveu alerta de Vendas ${id}`,
    }).catch(() => {});

    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
