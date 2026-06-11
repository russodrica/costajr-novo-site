import type { APIRoute } from "astro";
import {
  getPortalToken,
  getAdminTokenFromCookie,
  verifyToken,
  jsonOk,
  jsonErr,
  type AdminClaims,
} from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";

export const prerender = false;

async function autenticar(request: Request): Promise<AdminClaims> {
  const tok = getPortalToken(request) || getAdminTokenFromCookie(request);
  if (!tok) throw new Error("Não autenticado");
  const claims = await verifyToken<AdminClaims>(tok);
  if (claims.tipo !== "admin") throw new Error("Token inválido");
  return claims;
}

// GET — dados do próprio usuário
export const GET: APIRoute = async ({ request }) => {
  try {
    const claims = await autenticar(request);
    const db = supabaseAdmin();
    const { data, error } = await db
      .from("portal_profiles")
      .select("id, email, display_name, full_name, role")
      .eq("id", claims.sub)
      .single();
    if (error || !data) return jsonErr(404, "Usuário não encontrado.");
    return jsonOk(data);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" || e.message === "Token inválido" ? 401 : 500, e.message);
  }
};

// PATCH — edição do próprio perfil (nome). Cargo e e-mail só o admin altera em /admin/membros.
export const PATCH: APIRoute = async ({ request }) => {
  try {
    const claims = await autenticar(request);
    const body = await request.json();
    const updates: Record<string, any> = {};
    if (typeof body.display_name === "string" && body.display_name.trim()) {
      updates.display_name = body.display_name.trim();
    }
    if (typeof body.full_name === "string") {
      updates.full_name = body.full_name.trim();
    }
    if (Object.keys(updates).length === 0) return jsonErr(400, "Nada para atualizar.");
    const db = supabaseAdmin();
    const { data, error } = await db
      .from("portal_profiles")
      .update(updates)
      .eq("id", claims.sub)
      .select("id, email, display_name, full_name, role")
      .single();
    if (error) return jsonErr(400, error.message);
    return jsonOk(data);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" || e.message === "Token inválido" ? 401 : 500, e.message);
  }
};
