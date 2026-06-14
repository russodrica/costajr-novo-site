import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";
import { excluirComLixeira, registrarAcao } from "../../../../lib/auditoria";

export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const body = await request.json();
    delete body.senha_hash;
    const db = supabaseAdmin();
    const { data, error } = await db.from("portal_profiles").update(body).eq("id", params.id!).select().single();
    if (error) return jsonErr(400, error.message);
    await registrarAcao(db, { req: request, admin }, { acao: "editar", entidade: "portal_profiles", registro_id: params.id!, descricao: `Editou membro "${data.display_name || data.email || params.id}"`, dados: body });
    return jsonOk(data);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// DELETE /api/admin/membros/[id] — exclui o membro (não permite excluir a si mesmo)
export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const db = supabaseAdmin();
    const { data: alvo } = await db.from("portal_profiles").select("id, email, display_name").eq("id", params.id!).maybeSingle();
    if (!alvo) return jsonErr(404, "Membro não encontrado");
    if (alvo.email && admin.email && alvo.email.toLowerCase() === admin.email.toLowerCase()) {
      return jsonErr(400, "Você não pode excluir o seu próprio usuário.");
    }
    // remove dependências sem valor histórico; conteúdos criados permanecem
    await db.from("portal_sessoes").delete().eq("user_id", params.id!);
    const nome = alvo.display_name || alvo.email || params.id!;
    const r = await excluirComLixeira(db, { req: request, admin }, {
      tabela: "portal_profiles", id: params.id!, idCol: "id", entidade: "portal_profiles",
      descricao: `Excluiu membro "${nome}"`,
    });
    if (!r.ok) {
      // FKs de histórico (fórum, onboarding, termos) impedem apagar — desativa em vez de excluir
      const { error: e2 } = await db.from("portal_profiles").update({ approval_status: "rejected" }).eq("id", params.id!);
      if (e2) return jsonErr(400, r.error || "Falha ao excluir");
      await registrarAcao(db, { req: request, admin }, { acao: "excluir", entidade: "portal_profiles", registro_id: params.id!, descricao: `Desativou membro "${nome}" (histórico vinculado impede exclusão)` });
      return jsonOk({ ok: true, desativado: true, aviso: "Membro tem histórico vinculado (fórum/termos) — foi desativado (acesso bloqueado) em vez de excluído." });
    }
    return jsonOk({ ok: true, excluido: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
