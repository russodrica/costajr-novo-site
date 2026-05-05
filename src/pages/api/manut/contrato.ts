import type { APIRoute } from "astro";
import { jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";

export const prerender = false;

// Endpoint público — retorna o texto do contrato para exibição no wizard de contratação.
export const GET: APIRoute = async () => {
  try {
    const { data } = await supabaseAdmin()
      .from("manut_contrato")
      .select("texto, updated_at")
      .eq("id", 1)
      .maybeSingle();
    return jsonOk({ texto: data?.texto || "", updated_at: data?.updated_at });
  } catch (e: any) {
    return jsonErr(500, e.message);
  }
};
