import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { bloqueioSeSoLeitura } from "../../../../../lib/permissoes";
import { iniciarDesligamento } from "../../../../../lib/desligamento";

export const prerender = false;

// POST /api/admin/rh/desligamentos/iniciar { colaborador_id }
// Marca o colaborador como EM DESLIGAMENTO e corta os acessos automáticos
// (PortalCJR + Telegram) + gera tarefas para a TI (bancos, Vobi, etc.).
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const _ro = await bloqueioSeSoLeitura(admin, "rh"); if (_ro) return _ro;
    const { colaborador_id } = await request.json();
    if (!colaborador_id) return jsonErr(400, "colaborador_id é obrigatório.");
    const resumo = await iniciarDesligamento(supabaseAdmin(), colaborador_id, admin, request);
    return jsonOk({ ok: true, ...resumo });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message || "Falha ao iniciar desligamento.");
  }
};
