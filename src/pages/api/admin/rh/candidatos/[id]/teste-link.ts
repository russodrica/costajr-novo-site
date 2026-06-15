import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../../lib/supabase";
import { registrarAcao } from "../../../../../../lib/auditoria";
import { bloqueioSeSoLeitura } from "../../../../../../lib/permissoes";

export const prerender = false;

// POST — gera (ou reaproveita) o token do teste de perfil do candidato e devolve o link.
export const POST: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const _ro = await bloqueioSeSoLeitura(admin, "recrutamento"); if (_ro) return _ro;
    const db = supabaseAdmin();
    const id = params.id!;
    const { data: cand } = await db.from("rh_candidatos").select("id, nome, teste_token").eq("id", id).maybeSingle();
    if (!cand) return jsonErr(404, "Candidato não encontrado");

    let token = cand.teste_token;
    if (!token) {
      token = `disc-${crypto.randomUUID().replace(/-/g, "").slice(0, 18)}`;
      const { error } = await db.from("rh_candidatos").update({ teste_token: token }).eq("id", id);
      if (error) return jsonErr(400, error.message);
      await registrarAcao(db, { req: request, admin }, { acao: "editar", entidade: "rh_candidatos", registro_id: id, descricao: `Gerou link de teste de perfil para "${cand.nome}"`, dados: {} });
    }
    return jsonOk({ token, path: `/teste/${token}` });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
