import type { APIRoute } from "astro";
import { requireAdminCookie } from "../../../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../../../lib/supabase";
import { bloqueioSeSemLeitura } from "../../../../../../../lib/permissoes";
import { gerarEpiFichaPdf } from "../../../../../../../lib/epiPdf";

export const prerender = false;

// GET /api/admin/rh/epi/fichas/[id]/pdf — gera o PDF da ficha para impressão.
export const GET: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const ro = await bloqueioSeSemLeitura(admin, "rh"); if (ro) return ro;
    const db = supabaseAdmin();
    const { data: ficha } = await db.from("epi_fichas").select("*").eq("id", params.id!).maybeSingle();
    if (!ficha) return new Response("Ficha não encontrada", { status: 404 });
    const { data: colab } = await db.from("rh_colaboradores").select("nome, cargo, setor, cpf, rg, data_admissao, data_desligamento").eq("id", ficha.colaborador_id).maybeSingle();

    // logo (do próprio site) — opcional; nunca derruba a geração
    let logoBytes: Uint8Array | null = null;
    try {
      const origem = new URL(request.url).origin;
      const lr = await fetch(`${origem}/logo-cjr.png`);
      if (lr.ok) logoBytes = new Uint8Array(await lr.arrayBuffer());
    } catch { logoBytes = null; }

    const pdf = await gerarEpiFichaPdf({
      colaborador: colab?.nome || "—", cargo: colab?.cargo, setor: colab?.setor, cpf: colab?.cpf,
      rg: colab?.rg, data_admissao: colab?.data_admissao, data_demissao: colab?.data_desligamento,
      tipo: ficha.tipo, data_geracao: ficha.data_geracao, itens: ficha.itens || [], logoBytes,
    });
    const nome = `ficha-epi-${(colab?.nome || "colaborador").replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}-${ficha.data_geracao}.pdf`;
    return new Response(pdf as unknown as BodyInit, {
      status: 200,
      headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${nome}"` },
    });
  } catch (e: any) {
    return new Response(e.message === "Não autenticado" ? "Não autenticado" : e.message, { status: e.message === "Não autenticado" ? 401 : 500 });
  }
};
