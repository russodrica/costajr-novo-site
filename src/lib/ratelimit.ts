import { supabaseAdmin } from "./supabase";

/** IP do cliente a partir dos headers da Vercel (x-forwarded-for tem o IP real). */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") || "";
  const first = xff.split(",")[0].trim();
  return first || req.headers.get("x-real-ip") || "desconhecido";
}

/**
 * Rate limit por janela fixa, ATÔMICO no Postgres (seguro em serverless — várias
 * lambdas compartilham o mesmo contador). Retorna true se PERMITIDO, false se
 * estourou o limite. FAIL-OPEN: qualquer erro de infra deixa passar (nunca trava
 * o app por causa do limitador). Requer migration 067 (função rl_hit).
 */
export async function rateLimit(bucket: string, limite: number, janelaSegs: number): Promise<boolean> {
  try {
    const db = supabaseAdmin();
    const { data, error } = await db.rpc("rl_hit", {
      p_bucket: bucket.slice(0, 200),
      p_limit: limite,
      p_window_secs: janelaSegs,
    });
    if (error) return true; // fail-open
    return data === true;
  } catch {
    return true; // fail-open
  }
}
