import type { APIRoute } from "astro";
import { requireAdmin, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    await requireAdmin(request);
    const url = new URL(request.url);
    const status = url.searchParams.get("status");

    let q = supabaseAdmin()
      .from("manut_suporte")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);

    if (status) q = q.eq("status", status);

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return jsonOk(data || []);
  } catch (e: any) {
    return jsonErr(e.message === "Não autorizado" ? 401 : 500, e.message);
  }
};
