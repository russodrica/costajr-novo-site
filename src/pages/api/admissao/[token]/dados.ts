import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { jsonOk, jsonErr } from "~/lib/auth";

export const prerender = false;

// POST /api/admissao/[token]/dados — endpoint PÚBLICO (candidato atualiza contato).
// body: { telefone?, email? }
export const POST: APIRoute = async ({ request, params }) => {
  try {
    const db = supabaseAdmin();
    const { data: adm } = await db
      .from("rh_admissoes")
      .select("id, status")
      .eq("token", params.token!)
      .maybeSingle();
    if (!adm) return jsonErr(404, "Link de admissão não encontrado");
    if (!["aguardando", "docs_enviados"].includes(adm.status)) {
      return jsonErr(400, "Esta admissão já foi finalizada");
    }

    const body = await request.json().catch(() => ({}));
    const upd: Record<string, unknown> = {};
    if (body.telefone !== undefined) upd.telefone = String(body.telefone).trim().slice(0, 30) || null;
    if (body.email !== undefined) {
      const email = String(body.email).trim().slice(0, 150);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonErr(400, "E-mail inválido");
      upd.email = email || null;
    }
    if (!Object.keys(upd).length) return jsonErr(400, "Nada para atualizar");

    upd.updated_at = new Date().toISOString();
    const { error } = await db.from("rh_admissoes").update(upd).eq("id", adm.id);
    if (error) return jsonErr(400, error.message);
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(500, e.message);
  }
};
