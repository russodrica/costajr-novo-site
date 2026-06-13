import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { requireAdminCookie, jsonOk, jsonErr } from "~/lib/auth";

export const prerender = false;

// GET — progresso de onboarding por colaborador (para o RH/admin acompanhar)
export const GET: APIRoute = async ({ request }) => {
  try {
    await requireAdminCookie(request);
    const sb = supabaseAdmin();
    const [{ data: steps }, { data: perfis }, { data: prog }] = await Promise.all([
      sb.from("portal_onboarding_steps").select("id, obrigatorio, access_roles"),
      sb.from("portal_profiles").select("id, full_name, display_name, email, role, roles, created_at").eq("approval_status", "approved"),
      sb.from("portal_onboarding_progress").select("user_id, step_id, concluido, concluido_em"),
    ]);

    const progPorUser = new Map<string, Map<string, { concluido: boolean; em: string | null }>>();
    for (const p of prog || []) {
      if (!progPorUser.has(p.user_id)) progPorUser.set(p.user_id, new Map());
      progPorUser.get(p.user_id)!.set(p.step_id, { concluido: p.concluido, em: p.concluido_em });
    }

    const linhas = (perfis || []).map((u: any) => {
      const rolesUser: string[] = u.roles?.length ? u.roles : [u.role];
      // só conta etapas visíveis para o perfil do colaborador
      const visiveis = (steps || []).filter((s: any) => {
        const ar = s.access_roles || ["all"];
        return ar.includes("all") || rolesUser.some((r) => ar.includes(r));
      });
      const meu = progPorUser.get(u.id);
      const concluidas = visiveis.filter((s) => meu?.get(s.id)?.concluido).length;
      const obrigPend = visiveis.filter((s) => s.obrigatorio && !meu?.get(s.id)?.concluido).length;
      const ultimas = [...(meu?.values() || [])].map((x) => x.em).filter(Boolean).sort();
      return {
        user_id: u.id,
        nome: u.full_name || u.display_name || u.email,
        email: u.email,
        roles: rolesUser,
        total: visiveis.length,
        concluidas,
        pct: visiveis.length ? Math.round((concluidas / visiveis.length) * 100) : 0,
        obrigatorias_pendentes: obrigPend,
        ultima_atividade: ultimas[ultimas.length - 1] || null,
      };
    }).sort((a, b) => a.pct - b.pct || a.nome.localeCompare(b.nome));

    return jsonOk({ colaboradores: linhas, total_etapas: steps?.length ?? 0 });
  } catch {
    return jsonErr(401, "Não autenticado.");
  }
};
