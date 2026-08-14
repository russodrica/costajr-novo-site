import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";
import { registrarAcao } from "../../../../lib/auditoria";
import { bloqueioSeSoLeitura } from "../../../../lib/permissoes";

export const prerender = false;
const MODULO = "obras";

// POST /api/admin/obras/diario  { obra_id, data, modelo_checklist_id? }
// Cria o relatório do dia. A obra vem do cadastro que já existe no portal —
// não há um segundo cadastro de obras para alguém manter em dia.
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const bl = await bloqueioSeSoLeitura(admin, MODULO); if (bl) return bl;
    const db = supabaseAdmin();

    const body = await request.json().catch(() => null);
    if (!body?.obra_id) return jsonErr(400, "Escolha a obra.");
    const data = String(body.data || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return jsonErr(400, "Informe a data do relatório.");

    const { data: obra } = await db.from("obras").select("id, nome").eq("id", body.obra_id).maybeSingle();
    if (!obra) return jsonErr(404, "Obra não encontrada.");

    // um relatório por obra por dia (a própria tabela tem unique(obra_id, data)):
    // em vez de estourar erro de banco, devolvemos o que já existe
    const { data: ja } = await db.from("obras_rdo").select("id")
      .eq("obra_id", body.obra_id).eq("data", data).maybeSingle();
    if (ja) return jsonOk({ id: ja.id, jaExistia: true });

    const { data: novo, error } = await db.from("obras_rdo").insert({
      obra_id: body.obra_id,
      data,
      status: "rascunho",
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
      descricao: `RDO ${data} — obra "${obra.nome}"`,
    });
    return jsonOk({ id: novo.id }, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
