import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { requireAdmin, jsonOk, jsonErr } from "~/lib/auth";

export const prerender = false;

// Campos sensíveis que NÃO devem aparecer para o colaborador no portal (LGPD — minimização):
// segredos operacionais e dados de registro que o portador não precisa no dia a dia.
// O admin continua vendo tudo na ficha do ativo.
const CAMPOS_OCULTOS_PORTAL = new Set(["pin_puk", "renavam", "chassi", "mac"]);
function camposSeguros(campos: Record<string, unknown> | null | undefined) {
  if (!campos || typeof campos !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(campos)) if (!CAMPOS_OCULTOS_PORTAL.has(k)) out[k] = v;
  return out;
}

// GET /api/portal/meus-equipamentos
// Equipamentos sob responsabilidade do colaborador logado + termos (pendentes e aceitos)
export const GET: APIRoute = async ({ request }) => {
  try {
    const claims = await requireAdmin(request);
    const sb = supabaseAdmin();

    const [{ data: ativos, error: e1 }, { data: termos, error: e2 }] = await Promise.all([
      sb.from("ativos")
        .select("id, descricao, categoria, subcategoria, marca, modelo, numero_serie, numero_patrimonial, status, fotos, campos, updated_at")
        .eq("alocado_para_tipo", "colaborador")
        .eq("alocado_para_id", claims.sub),
      sb.from("ativos_termos")
        .select("id, ativo_id, conteudo, condicao, status, aceito_em, created_at")
        .eq("colaborador_id", claims.sub)
        .neq("status", "cancelado")
        .order("created_at", { ascending: false }),
    ]);
    if (e1) return jsonErr(500, e1.message);
    if (e2) return jsonErr(500, e2.message);

    // histórico de movimentações dos equipamentos do colaborador
    const ids = (ativos || []).map(a => a.id);
    let movimentos: any[] = [];
    if (ids.length) {
      const { data } = await sb.from("ativos_movimentos")
        .select("id, ativo_id, tipo, descricao, condicao, created_at")
        .in("ativo_id", ids)
        .order("created_at", { ascending: false })
        .limit(100);
      movimentos = data || [];
    }

    const ativosSeguros = (ativos || []).map((a) => ({ ...a, campos: camposSeguros(a.campos) }));
    return jsonOk({ ativos: ativosSeguros, termos: termos || [], movimentos });
  } catch {
    return jsonErr(401, "Não autenticado.");
  }
};
