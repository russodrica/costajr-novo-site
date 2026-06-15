import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../../lib/supabase";
import { registrarAcao } from "../../../../../../lib/auditoria";
import { bloqueioSeSoLeitura } from "../../../../../../lib/permissoes";

export const prerender = false;

// POST /api/admin/rh/candidatos/[id]/contratar
//   { regime?, cargo?, data_admissao? } → cria o colaborador a partir do candidato,
//   marca a etapa como "contratado" e vincula. Vaga vai p/ "preenchida".
export const POST: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const _ro = await bloqueioSeSoLeitura(admin, "recrutamento"); if (_ro) return _ro;
    const id = params.id!;
    const body = await request.json().catch(() => ({}));
    const db = supabaseAdmin();

    const { data: cand } = await db.from("rh_candidatos").select("*, rh_vagas(cargo, regime, setor, titulo)").eq("id", id).maybeSingle();
    if (!cand) return jsonErr(404, "Candidato não encontrado");
    if (cand.colaborador_id) return jsonErr(400, "Candidato já foi contratado.");
    const vaga: any = cand.rh_vagas;

    const novo: any = {
      nome: cand.nome, email: cand.email || null, telefone: cand.telefone || null,
      cargo: body.cargo || vaga?.cargo || null,
      regime: body.regime || vaga?.regime || "clt",
      setor: vaga?.setor || null,
      data_admissao: body.data_admissao || new Date().toISOString().slice(0, 10),
      status: "ativo", criado_por: admin.email,
    };
    const { data: colab, error } = await db.from("rh_colaboradores").insert(novo).select().single();
    if (error) return jsonErr(400, error.message);

    await db.from("rh_candidatos").update({ etapa: "contratado", colaborador_id: colab.id, updated_at: new Date().toISOString() }).eq("id", id);
    if (cand.vaga_id) await db.from("rh_vagas").update({ status: "preenchida", updated_at: new Date().toISOString() }).eq("id", cand.vaga_id);

    await registrarAcao(db, { req: request, admin }, { acao: "criar", entidade: "rh_colaboradores", registro_id: colab.id, descricao: `Contratou "${colab.nome}" (a partir do candidato)`, dados: { candidato_id: id } });
    return jsonOk({ ok: true, colaborador_id: colab.id });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
