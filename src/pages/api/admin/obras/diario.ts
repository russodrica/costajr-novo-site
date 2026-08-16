import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";
import { registrarAcao } from "../../../../lib/auditoria";
import { bloqueioSeSoLeitura } from "../../../../lib/permissoes";
import { empresaValida, areaValida, areaDe } from "../../../../lib/rdo";

export const prerender = false;
const MODULO = "obras-diario";

// POST /api/admin/obras/diario  { obra_id, data, empresa?, modelo_checklist_id? }
// Cria o Relatório de Visita. O caminho começa pela OBRA: ela é cadastrada uma
// vez em /admin/obras e o relatório nasce de dentro dela — não há um segundo
// cadastro de obras para alguém manter em dia.
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const bl = await bloqueioSeSoLeitura(admin, MODULO); if (bl) return bl;
    const db = supabaseAdmin();

    const body = await request.json().catch(() => null);

    // Duas carteiras: Obras & Projetos (tabela `obras`) e Fundação
    // (`obras_fundacao`). A área diz de onde vem a obra e qual coluna do
    // relatório é preenchida — o banco não deixa as duas ao mesmo tempo.
    const area = areaValida(body?.area);
    const daFundacao = area === "fundacao";
    const vinculoId = String((daFundacao ? body?.fundacao_id : body?.obra_id) || "").trim();
    if (!vinculoId) return jsonErr(400, "Escolha a obra.");

    const data = String(body.data || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return jsonErr(400, "Informe a data da visita.");

    const { data: obra } = await db.from(areaDe(area).tabela)
      .select("id, nome").eq("id", vinculoId).maybeSingle();
    if (!obra) return jsonErr(404, "Obra não encontrada.");

    // Cada visita gera SEU relatório, mesmo que duas caiam no mesmo dia.
    // (Antes o sistema devolvia o relatório existente daquela data, e a tela
    // abria "preenchida sozinha" quando a pessoa pedia um novo.)
    const { count: noDia } = await db.from("obras_rdo")
      .select("*", { count: "exact", head: true })
      .eq(daFundacao ? "fundacao_id" : "obra_id", vinculoId).eq("data", data);

    const { data: novo, error } = await db.from("obras_rdo").insert({
      area,
      obra_id: daFundacao ? null : vinculoId,
      fundacao_id: daFundacao ? vinculoId : null,
      data,
      status: "rascunho",
      empresa: empresaValida(body.empresa || areaDe(area).empresaPadrao),
      responsavel: String(body.responsavel || "").trim() || null,
      criado_por: admin.email || null,
    }).select("id").single();
    if (error) {
      console.error("[rdo] insert falhou:", error.code, error.message, error.details);
      return jsonErr(400, "Não deu para criar o relatório agora.");
    }

    // checklist a partir de um modelo, se a pessoa escolheu um
    if (body.modelo_checklist_id) {
      const { data: modelo } = await db.from("obras_checklist_modelos")
        .select("itens").eq("id", body.modelo_checklist_id).maybeSingle();
      const itens: string[] = Array.isArray(modelo?.itens) ? modelo!.itens : [];
      if (itens.length) {
        await db.from("obras_rdo_checklist").insert(
          itens.map((item, i) => ({ rdo_id: novo.id, item: String(item).slice(0, 300), ordem: i })),
        );
      }
    }

    await registrarAcao(db, { req: request, admin }, {
      acao: "criar", entidade: "obras_rdo", registro_id: novo.id,
      descricao: `Relatório de visita ${data} — ${areaDe(area).label}: "${obra.nome}"`,
    });
    return jsonOk({ id: novo.id, outrosNoDia: Number(noDia) || 0 }, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
