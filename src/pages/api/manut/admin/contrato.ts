import type { APIRoute } from "astro";
import { requireAdmin, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    await requireAdmin(request);
    const { data } = await supabaseAdmin()
      .from("manut_contrato")
      .select("texto,updated_at")
      .eq("id", 1)
      .maybeSingle();
    return jsonOk({ texto: data?.texto || "", updated_at: data?.updated_at });
  } catch (e: any) {
    return jsonErr(e.message === "Não autorizado" ? 401 : 500, e.message);
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    await requireAdmin(request);
    const { texto } = await request.json();
    if (typeof texto !== "string") return jsonErr(400, "texto obrigatório");

    const { error } = await supabaseAdmin()
      .from("manut_contrato")
      .upsert({ id: 1, texto, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autorizado" ? 401 : 500, e.message);
  }
};
