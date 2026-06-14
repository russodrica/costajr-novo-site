import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { requireAdminCookie, jsonOk, jsonErr } from "~/lib/auth";
import { registrarAcao } from "~/lib/auditoria";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const claims = await requireAdminCookie(request);
    const { title, content, category, target_role } = await request.json();
    if (!title || !content) return jsonErr(400, "Campos obrigatórios ausentes.");
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("portal_announcements")
      .insert({ title, content, category: category || "comunicado", target_role: target_role || "all", created_by: claims.sub })
      .select().single();
    if (error) return jsonErr(500, "Erro ao criar comunicado.");

    await registrarAcao(sb, { req: request, admin: { email: claims.email, role: claims.role } }, {
      acao: "criar",
      entidade: "portal_announcements",
      registro_id: data?.id,
      descricao: `Criou comunicado "${title}"`,
      dados: data,
    });

    // Notifica os colaboradores no sino do portal (todos ou só o perfil alvo)
    try {
      const { data: perfis } = await sb.from("portal_profiles").select("id, role, roles").eq("approval_status", "approved");
      const alvo = target_role && target_role !== "all" ? target_role : null;
      const destinatarios = (perfis || []).filter((p: any) => {
        if (!alvo) return true;
        const roles = p.roles?.length ? p.roles : [p.role];
        return roles.includes(alvo);
      });
      if (destinatarios.length) {
        await sb.from("portal_notificacoes").insert(destinatarios.map((p: any) => ({
          user_id: p.id, tipo: "comunicado",
          titulo: `📢 Novo comunicado: ${title}`,
          mensagem: String(content).slice(0, 160),
          link: "/portal",
        })));
      }
    } catch { /* melhor-esforço; o comunicado já foi criado */ }

    return jsonOk(data, 201);
  } catch { return jsonErr(401, "Não autenticado."); }
};
