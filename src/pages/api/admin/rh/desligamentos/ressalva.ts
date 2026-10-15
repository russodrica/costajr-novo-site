import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";
import { bloqueioSeSoLeitura } from "../../../../../lib/permissoes";
import { normalizarRessalva } from "../../../../../lib/desligamento";

export const prerender = false;

// POST /api/admin/rh/desligamentos/ressalva
//   { colaborador_id, texto, rescisao_pendente, valor_rescisao, previsao_rescisao }
//   Acrescenta uma RESSALVA ao histórico do desligamento SEM mexer no status do
//   colaborador. Só para quem está "em desligamento" (vai para o registro "aberto",
//   que o finalizar reaproveita ao concluir) ou "desligado" (vai para o registro
//   concluído mais recente). Autor e data são gravados aqui; nunca apaga ressalvas.
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const _ro = await bloqueioSeSoLeitura(admin, "rh"); if (_ro) return _ro;
    const body = await request.json();
    if (!body.colaborador_id) return jsonErr(400, "colaborador_id é obrigatório.");
    const ress = normalizarRessalva(body);
    if (!ress) return jsonErr(400, "Descreva a ressalva (mínimo de 15 caracteres).");
    const db = supabaseAdmin();

    const { data: colab } = await db.from("rh_colaboradores").select("id, nome, status, data_desligamento").eq("id", body.colaborador_id).maybeSingle();
    if (!colab) return jsonErr(404, "Colaborador não encontrado");
    if (!["em_desligamento", "desligado"].includes(colab.status)) {
      return jsonErr(400, "Ressalva de desligamento só vale para quem está em desligamento ou já desligado.");
    }

    const nova = { ...ress, pendencias: [] as string[], itens_avariados: [] as string[], por: admin.email, em: new Date().toISOString(), momento: "posterior" };
    const statusAlvo = colab.status === "em_desligamento" ? "aberto" : "concluido";

    let registroId: string | null = null;
    // Acréscimo com controle otimista (confere o updated_at lido) — se outra gravação
    // entrou no meio, relê e tenta de novo, para nenhuma ressalva se perder.
    for (let tentativa = 0; tentativa < 3 && !registroId; tentativa++) {
      const { data: alvo } = await db.from("rh_desligamentos").select("id, checklist, updated_at")
        .eq("colaborador_id", colab.id).eq("status", statusAlvo).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!alvo) {
        const { data: novo, error } = await db.from("rh_desligamentos").insert({
          colaborador_id: colab.id, data_desligamento: colab.data_desligamento || null,
          checklist: { ressalvas: [nova], origem: "ressalva_posterior" }, status: statusAlvo, criado_por: admin.email,
        }).select("id").single();
        if (error) return jsonErr(400, error.message);
        registroId = novo.id;
        break;
      }
      const ck = (alvo.checklist && typeof alvo.checklist === "object") ? alvo.checklist : {};
      const ressalvas = Array.isArray(ck.ressalvas) ? ck.ressalvas : [];
      const { data: upd, error } = await db.from("rh_desligamentos")
        .update({ checklist: { ...ck, ressalvas: [...ressalvas, nova] }, updated_at: new Date().toISOString() })
        .eq("id", alvo.id).eq("updated_at", alvo.updated_at).select("id");
      if (error) return jsonErr(400, error.message);
      if (upd && upd.length) registroId = alvo.id;
    }
    if (!registroId) return jsonErr(409, "Outra gravação aconteceu ao mesmo tempo. Tente salvar de novo.");

    await registrarAcao(db, { req: request, admin }, {
      acao: "editar", entidade: "rh_desligamentos", registro_id: registroId,
      descricao: `Ressalva no desligamento de "${colab.nome}": ${ress.texto}${ress.rescisao_pendente ? " [verbas rescisórias pendentes]" : ""}`,
      dados: { colaborador_id: colab.id, ressalva: nova },
    });
    return jsonOk({ ok: true, desligamento_id: registroId }, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
