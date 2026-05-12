import type { APIRoute } from "astro";
import { verifyToken, type AdminClaims, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";

export const prerender = false;

async function ensureAdmin(request: Request) {
  const cookie = request.headers.get("cookie") || "";
  const m = cookie.match(/admin_token=([^;]+)/);
  if (!m) throw new Error("Não autorizado");
  const claims = await verifyToken<AdminClaims>(m[1]);
  if (claims.tipo !== "admin") throw new Error("Não autorizado");
  return claims;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    await ensureAdmin(request);
    const body = await request.json();
    const codigo = String(body.codigo || "").trim().toUpperCase();
    const desconto = Number(body.desconto_percentual);
    if (!codigo) return jsonErr(400, "Código obrigatório");
    if (!desconto || desconto <= 0 || desconto > 100) return jsonErr(400, "Desconto deve ser entre 1 e 100");

    const db = supabaseAdmin();
    const { data: dup } = await db.from("manut_cupons").select("id").eq("codigo", codigo).maybeSingle();
    if (dup) return jsonErr(409, "Código já existe");

    const { error } = await db.from("manut_cupons").insert({
      codigo,
      descricao: body.descricao || null,
      desconto_percentual: desconto,
      duracao_meses: 1,
      usos_maximos: body.usos_maximos || null,
      validade: body.validade ? new Date(body.validade).toISOString() : null,
      tipo: "desconto",
      ativo: true,
    });
    if (error) throw new Error(error.message);
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autorizado" ? 401 : 400, e.message);
  }
};
