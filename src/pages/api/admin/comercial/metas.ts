import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";

export const prerender = false;

function refAtual(): string {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}`;
}

// GET /api/admin/comercial/metas?referencia=YYYY-MM — meta + realizado do mês
export const GET: APIRoute = async ({ request, url }) => {
  try {
    await requireAdminCookie(request);
    const ref = url.searchParams.get("referencia") || refAtual();
    if (!/^\d{4}-\d{2}$/.test(ref)) return jsonErr(400, "Referência inválida (use YYYY-MM)");

    const db = supabaseAdmin();

    // Meta cadastrada (tabela com_metas pode não existir ainda em produção)
    let meta: unknown = null;
    let aviso: string | undefined;
    const m = await db.from("com_metas").select("*").eq("referencia", ref).maybeSingle();
    if (m.error) {
      aviso = "Tabela com_metas indisponível — rode db/migrations/023_comercial.sql no Supabase.";
    } else {
      meta = m.data;
    }

    // Janela do mês [início, próximo mês)
    const [ano, mes] = ref.split("-").map(Number);
    const inicio = new Date(Date.UTC(ano, mes - 1, 1)).toISOString();
    const fim = new Date(Date.UTC(ano, mes, 1)).toISOString();

    // Realizado: convertidos no mês (via updated_at) + soma de valor
    const conv = await db
      .from("manut_leads")
      .select("valor")
      .eq("etapa", "convertido")
      .gte("updated_at", inicio)
      .lt("updated_at", fim);
    if (conv.error) return jsonErr(500, conv.error.message);
    const valorConvertido = (conv.data || []).reduce((s, l) => s + Number(l.valor || 0), 0);

    // Leads criados no mês
    const criados = await db
      .from("manut_leads")
      .select("id", { count: "exact", head: true })
      .gte("created_at", inicio)
      .lt("created_at", fim);

    return jsonOk({
      referencia: ref,
      meta,
      realizado: {
        valor_convertido: valorConvertido,
        convertidos: conv.data?.length || 0,
        leads_criados: criados.count ?? 0,
      },
      aviso,
    });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// PUT /api/admin/comercial/metas — upsert da meta do mês (chave: referencia)
export const PUT: APIRoute = async ({ request }) => {
  try {
    await requireAdminCookie(request);
    const body = await request.json();
    const ref = body.referencia || refAtual();
    if (!/^\d{4}-\d{2}$/.test(ref)) return jsonErr(400, "Referência inválida (use YYYY-MM)");

    const row: Record<string, unknown> = { referencia: ref, updated_at: new Date().toISOString() };
    for (const c of ["meta_valor", "meta_leads", "meta_conversoes"]) {
      if (body[c] !== undefined) row[c] = body[c] === "" ? null : body[c];
    }

    const db = supabaseAdmin();
    const { data, error } = await db
      .from("com_metas")
      .upsert(row, { onConflict: "referencia" })
      .select()
      .single();
    if (error) return jsonErr(400, error.message);
    return jsonOk(data);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
