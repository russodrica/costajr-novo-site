import type { APIRoute } from "astro";
import { requireAdminCookie, temPerfil, hashSenha, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";
import { registrarAcao } from "../../../../lib/auditoria";

export const prerender = false;
const PERFIS = ["admin"]; // gestão de acesso externo é só do admin
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Senha forte legível (12 chars: letras maiúsc/minúsc + dígitos) — mostrada UMA vez. */
function gerarSenhaForte(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const arr = new Uint32Array(12);
  crypto.getRandomValues(arr);
  return Array.from(arr, (n) => chars[n % chars.length]).join("");
}

// GET → lista os usuários fornecedores (role=fornecedor)
export const GET: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const db = supabaseAdmin();
    const { data, error } = await db.from("portal_profiles")
      .select("id, display_name, empresa, email, approval_status, last_login_at, created_at")
      .eq("role", "fornecedor")
      .order("created_at", { ascending: false });
    if (error) return jsonErr(400, error.message);
    return jsonOk({ fornecedores: data || [] });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// POST → cria um usuário fornecedor { nome, empresa, email } — retorna a senha gerada (1x)
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const b = await request.json();
    const nome = String(b.nome || "").trim();
    const empresa = String(b.empresa || "").trim();
    const email = String(b.email || "").trim().toLowerCase();
    if (!nome || !email) return jsonErr(400, "Informe nome e e-mail.");
    if (!EMAIL_RX.test(email)) return jsonErr(400, "E-mail inválido.");

    const db = supabaseAdmin();
    const { data: ja } = await db.from("portal_profiles").select("id, role").eq("email", email).maybeSingle();
    if (ja) return jsonErr(409, "Já existe um usuário com este e-mail.");

    const senha = gerarSenhaForte();
    const { data: row, error } = await db.from("portal_profiles").insert({
      email, display_name: nome, empresa: empresa || null,
      role: "fornecedor", roles: ["fornecedor"],
      approval_status: "approved",
      senha_hash: await hashSenha(senha),
    }).select("id").single();
    if (error) return jsonErr(400, error.message);

    await registrarAcao(db, { req: request, admin }, {
      acao: "criar", entidade: "portal_profiles", registro_id: row?.id ?? null,
      descricao: `Criou usuário FORNECEDOR ${nome}${empresa ? ` (${empresa})` : ""} <${email}>`,
      dados: { role: "fornecedor", empresa },
    }).catch(() => {});

    return jsonOk({ ok: true, id: row?.id, senha }); // senha mostrada UMA vez — não fica em log
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
