import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../lib/auth";
import { supabaseAdmin } from "../../../lib/supabase";
import { registrarAcao } from "../../../lib/auditoria";
import { GRUPOS_ADMIN, MODULO_GRUPO, nivelPadraoPerfil } from "../../../lib/permissoes";

export const prerender = false;

const NIVEIS = ["nenhum", "ver", "editar"];

// GET /api/admin/permissoes-usuarios
//   Retorna usuários (perfis aprovados), o catálogo de módulos e os overrides salvos.
export const GET: APIRoute = async ({ request }) => {
  try {
    await requireAdminCookie(request);
    const db = supabaseAdmin();
    const [{ data: profs }, { data: ovs }] = await Promise.all([
      db.from("portal_profiles")
        .select("id, display_name, full_name, email, role, roles, approval_status")
        .eq("approval_status", "approved"),
      db.from("portal_perm_usuario").select("profile_id, modulo, nivel"),
    ]);
    const usuarios = (profs || [])
      .map((p: any) => ({
        id: p.id,
        nome: p.full_name || p.display_name || p.email,
        email: p.email,
        perfis: (p.roles && p.roles.length ? p.roles : [p.role]).filter(Boolean),
      }))
      .sort((a: any, b: any) => String(a.nome).localeCompare(String(b.nome), "pt-BR"));
    const overrides: Record<string, Record<string, string>> = {};
    for (const o of ovs || []) {
      (overrides[o.profile_id] ||= {})[o.modulo] = o.nivel;
    }
    // Padrão herdado do perfil por usuário×módulo (para a célula "Herdar" mostrar a base).
    const todosModulos = GRUPOS_ADMIN.flatMap((g) => g.itens.map((m) => m.key));
    const padrao: Record<string, Record<string, string>> = {};
    for (const u of usuarios) {
      const m: Record<string, string> = {};
      for (const key of todosModulos) m[key] = nivelPadraoPerfil(MODULO_GRUPO[key] || "", u.perfis);
      padrao[u.id] = m;
    }
    return jsonOk({ usuarios, grupos: GRUPOS_ADMIN, overrides, padrao });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// PUT /api/admin/permissoes-usuarios
//   { usuarios: string[], overrides: [{ profile_id, modulo, nivel }] }
//   Substitui os overrides dos usuários informados (delete + insert). "Herdar" = sem linha.
export const PUT: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const body = await request.json();
    const usuarios: string[] = Array.isArray(body?.usuarios) ? body.usuarios.filter(Boolean) : [];
    const overrides: any[] = Array.isArray(body?.overrides) ? body.overrides : [];
    if (!usuarios.length) return jsonErr(400, "Nenhum usuário informado.");

    const db = supabaseAdmin();
    // valida e monta as linhas
    const rows: any[] = [];
    const now = new Date().toISOString();
    for (const o of overrides) {
      const profile_id = String(o?.profile_id || "");
      const modulo = String(o?.modulo || "");
      const nivel = String(o?.nivel || "");
      if (!profile_id || !modulo) continue;
      if (!usuarios.includes(profile_id)) continue;          // só dos usuários do payload
      if (!MODULO_GRUPO[modulo]) continue;                   // módulo desconhecido
      if (!NIVEIS.includes(nivel)) continue;                 // nível inválido
      rows.push({ profile_id, modulo, nivel, updated_at: now });
    }

    // substitui: apaga overrides dos usuários informados e insere os explícitos
    const { error: delErr } = await db.from("portal_perm_usuario").delete().in("profile_id", usuarios);
    if (delErr) return jsonErr(400, delErr.message);
    if (rows.length) {
      const { error: insErr } = await db.from("portal_perm_usuario").insert(rows);
      if (insErr) return jsonErr(400, insErr.message);
    }

    await registrarAcao(db, { req: request, admin }, {
      acao: "editar",
      entidade: "portal_perm_usuario",
      descricao: `Atualizou permissões por usuário (${usuarios.length} usuário(s), ${rows.length} regra(s) específica(s))`,
      dados: { usuarios: usuarios.length, regras: rows.length },
    });

    return jsonOk({ ok: true, regras: rows.length });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
