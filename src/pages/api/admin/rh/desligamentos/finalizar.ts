import type { APIRoute } from "astro";
import { requireAdminCookie, invalidarSessoesPortal, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";
import { enviarEmailSimples } from "../../../../../lib/mailer";
import { enviarTelegram, escTg } from "../../../../../lib/telegram";
import { bloqueioSeSoLeitura, temPerfilFresco } from "../../../../../lib/permissoes";
import { normalizarRessalva, escHtml } from "../../../../../lib/desligamento";

export const prerender = false;

const DESLIG_EMAIL = import.meta.env.RH_ALERT_EMAIL || "rh@costajr.com.br, adriana@costajr.com.br";
const SITE_DESL = import.meta.env.SITE_BASE_URL || "https://costajr.com.br";

// Ativos que ainda estão COM a pessoa: em uso ou com defeito (o bot/admin marca
// "danificado" sem tirar a alocação). Os dois precisam de um destino no desligamento.
const STATUS_EM_POSSE = ["alocado", "danificado"];

// POST /api/admin/rh/desligamentos/finalizar
//   { colaborador_id, data_desligamento, tipo, motivo, entrevista, checklist }
//   checklist = { itens:[{tipo,id,nome,devolvido,estado_ok}], aviso_previo,
//                 exame_emocional, exame_demissional, termo_encerramento, contrato_encerramento }
//   SÓ DESLIGA se TUDO foi devolvido em perfeito estado + passos CLT/PJ cumpridos.
//   ressalva (opcional) = { texto, rescisao_pendente, valor_rescisao, previsao_rescisao }:
//   ENCERRAR COM RESSALVA — quando algum passo do regime não pôde ser cumprido
//   (colaborador sumiu, termo não assinado, rescisão ainda não paga...) ou um item
//   voltou com avaria. Só o perfil admin pode dispensar algo com a ressalva; a
//   justificativa fica no histórico. Os ITENS em posse continuam tendo de ser marcados
//   um a um (devolvido / não devolvido).
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const _ro = await bloqueioSeSoLeitura(admin, "rh"); if (_ro) return _ro;
    const body = await request.json();
    const { colaborador_id, checklist = {}, tipo, motivo, entrevista } = body;
    if (!colaborador_id) return jsonErr(400, "colaborador_id é obrigatório.");
    const ress = body.ressalva ? normalizarRessalva(body.ressalva) : null;
    if (body.ressalva && !ress) return jsonErr(400, "Ressalva inválida: descreva o que ficou pendente e por quê (mínimo de 15 caracteres).");
    const hoje = new Date().toISOString().slice(0, 10);
    const dataDesl = String(body.data_desligamento || hoje);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataDesl) || Number.isNaN(Date.parse(dataDesl))) return jsonErr(400, "Data do desligamento inválida.");
    const db = supabaseAdmin();

    const { data: colab } = await db.from("rh_colaboradores").select("id, nome, regime, profile_id, status").eq("id", colaborador_id).maybeSingle();
    if (!colab) return jsonErr(404, "Colaborador não encontrado");
    if (colab.status === "desligado") return jsonErr(409, "Este colaborador já está desligado.");

    // 1) Re-confere a POSSE atual (não confia só no que o cliente mandou)
    const ids = [colab.id, colab.profile_id].filter(Boolean);
    const nomeLow = (colab.nome || "").toLowerCase();
    const { data: ativosAloc } = await db.from("ativos").select("id, descricao, patrimonio, status, alocado_para_id, alocado_para_nome")
      .eq("alocado_para_tipo", "colaborador").in("status", STATUS_EM_POSSE).limit(2000);
    const ativos = (ativosAloc || []).filter((a: any) => (a.alocado_para_id && ids.includes(a.alocado_para_id)) || (a.alocado_para_nome && String(a.alocado_para_nome).toLowerCase() === nomeLow));
    // Mesmo critério da tela de posse (posse.ts): EPI em uso e sem data de devolução.
    const { data: epis } = await db.from("epi_entregas").select("id, epi, ca").eq("colaborador_id", colaborador_id).eq("status", "ativo").is("data_devolucao", null);
    const epiPend = (epis || []);

    const marc: Record<string, any> = {};
    for (const it of (checklist.itens || [])) marc[`${it.tipo}:${it.id}`] = it;
    const nomeAtivo = (a: any) => a.descricao || a.patrimonio || a.id;
    const avariado = (m: any) => !!(m && !m.nao_recuperado && m.devolvido && !m.estado_ok);

    // Um item deixa de ser pendência se foi DEVOLVIDO em perfeito estado OU marcado
    // como NÃO DEVOLVIDO / não recuperável (colaborador sumiu → item vira extraviado).
    // Com ressalva, "devolvido com avaria" também fecha (o ativo vai p/ conserto).
    const semDestino: string[] = [];
    const comAvaria: string[] = [];
    for (const a of ativos) {
      const m = marc[`ativo:${a.id}`];
      const jaComDefeito = a.status === "danificado"; // defeito já registrado antes: devolver basta
      if (avariado(m) && !jaComDefeito) comAvaria.push(`Ativo: ${nomeAtivo(a)}`);
      else if (!(m && (m.nao_recuperado || (m.devolvido && (m.estado_ok || jaComDefeito))))) semDestino.push(`Ativo: ${nomeAtivo(a)}`);
    }
    for (const e of epiPend) {
      const m = marc[`epi:${e.id}`];
      if (avariado(m)) comAvaria.push(`EPI/Uniforme: ${e.epi}`);
      else if (!(m && (m.nao_recuperado || (m.devolvido && m.estado_ok)))) semDestino.push(`EPI/Uniforme: ${e.epi}`);
    }

    // 2) Passos por regime
    const pendPassos: string[] = [];
    if (colab.regime === "clt") {
      if (!checklist.exame_demissional) pendPassos.push("Exame demissional (ASO)");
      if (!checklist.exame_emocional) pendPassos.push("Exame emocional");
      if (!checklist.aviso_previo) pendPassos.push("Aviso prévio (cumprido ou dispensado)");
      if (!checklist.termo_encerramento) pendPassos.push("Termo de encerramento assinado");
    } else if (colab.regime === "pj") {
      if (!checklist.contrato_encerramento) pendPassos.push("Contrato de encerramento (PJ) assinado");
    }

    // Itens em posse: nem a ressalva dispensa — cada um precisa de um destino
    // (devolvido ou não devolvido), senão o patrimônio fica "alocado" a quem saiu.
    if (semDestino.length) {
      return jsonErr(400, "Desligamento bloqueado — marque cada item como devolvido ou 🚫 não devolvido:\n• " + semDestino.join("\n• ")
        + (pendPassos.length ? "\n\nPassos do regime pendentes:\n• " + pendPassos.join("\n• ") : ""));
    }
    if ((pendPassos.length || comAvaria.length) && !ress) {
      const partes: string[] = [];
      if (comAvaria.length) partes.push("Devolvido(s) com avaria (sem \"Perfeito estado\"):\n• " + comAvaria.join("\n• ") + "\n  → marque \"Perfeito estado\" ou conclua com ressalva; o ativo vai para \"Para conserto\".");
      if (pendPassos.length) partes.push("Passos do regime pendentes:\n• " + pendPassos.join("\n• "));
      return jsonErr(400, "Desligamento bloqueado.\n\n" + partes.join("\n\n")
        + "\n\nSe não for possível cumprir (ex.: colaborador sumiu), use \"⚠️ Concluir com ressalva\" e registre o motivo (administrador).");
    }
    // A ressalva só dispensa algo (passo do regime ou item com avaria) nas mãos do
    // perfil admin; sem nada a dispensar, ela fica só como observação registrada.
    if (ress && (pendPassos.length || comAvaria.length) && !(await temPerfilFresco(admin, ["admin"]))) {
      return jsonErr(403, "Só o administrador pode concluir o desligamento com pendências (ressalva).");
    }
    const ressalvaReg = ress
      ? { ...ress, pendencias: pendPassos, itens_avariados: comAvaria, por: admin.email, em: new Date().toISOString(), momento: "conclusao" }
      : null;

    // 3) Grava o registro do desligamento ANTES dos efeitos colaterais (se o banco
    //    recusar, nada foi baixado). Reaproveita o registro "aberto" (criado por uma
    //    ressalva anterior, ex.: rescisão pendente) e junta as ressalvas antigas.
    //    Só reaproveita quando a pessoa está no processo atual ("em desligamento") —
    //    um "aberto" de um processo antigo/cancelado não herda para este.
    const { data: aberto } = colab.status === "em_desligamento"
      ? await db.from("rh_desligamentos").select("id, checklist")
          .eq("colaborador_id", colab.id).eq("status", "aberto").order("created_at", { ascending: false }).limit(1).maybeSingle()
      : { data: null as any };
    const ressalvasAntigas = (aberto?.checklist && Array.isArray(aberto.checklist.ressalvas)) ? aberto.checklist.ressalvas : [];
    const { ressalvas: _ignorada, ...checklistLimpo } = (checklist && typeof checklist === "object") ? checklist : ({} as any);
    const checklistGravar = { ...checklistLimpo, ressalvas: [...ressalvasAntigas, ...(ressalvaReg ? [ressalvaReg] : [])], concluido_por: admin.email, concluido_em: new Date().toISOString() };
    const regDesl = { data_desligamento: dataDesl, tipo: tipo || null, motivo: motivo || null, entrevista: entrevista || null, checklist: checklistGravar, status: "concluido", updated_at: new Date().toISOString() };
    const { data: desl, error } = aberto
      ? await db.from("rh_desligamentos").update(regDesl).eq("id", aberto.id).select().single()
      : await db.from("rh_desligamentos").insert({ colaborador_id, ...regDesl, criado_por: admin.email }).select().single();
    if (error || !desl) return jsonErr(400, error?.message || "Não foi possível gravar o desligamento.");

    // 4) Devolve EPIs e ativos, revoga acessos e desliga.
    let episNaoDevolvidos = 0;
    for (const e of epiPend) {
      if (marc[`epi:${e.id}`]?.nao_recuperado) {
        // Não devolvido: NÃO registra devolução (antes gravava "devolvido" por engano).
        await db.from("epi_entregas").update({ status: "nao_devolvido", data_devolucao: null }).eq("id", e.id);
        episNaoDevolvidos++;
      } else {
        await db.from("epi_entregas").update({ status: "devolvido", data_devolucao: hoje }).eq("id", e.id);
      }
    }
    let ativosDevolvidos = 0, ativosExtraviados = 0, ativosAvariados = 0;
    const cancelarTermos = (ativoId: string) => db.from("ativos_termos").update({ status: "cancelado" }).eq("ativo_id", ativoId).neq("status", "cancelado");
    for (const a of ativos) {
      const m = marc[`ativo:${a.id}`];
      const antes = a.status || "alocado";
      if (m && m.nao_recuperado) {
        // Colaborador NÃO entregou o item → marca EXTRAVIADO (sai do estoque disponível),
        // mantendo alocado_para_nome p/ registrar COM QUEM sumiu. Reversível se aparecer.
        await db.from("ativos").update({ status: "extraviado" }).eq("id", a.id);
        await db.from("ativos_movimentos").insert({ ativo_id: a.id, tipo: "ocorrencia", descricao: `NÃO devolvido no desligamento de ${colab.nome} — marcado como extraviado`, status_anterior: antes, status_novo: "extraviado", feito_por: admin.email });
        ativosExtraviados++;
      } else if (avariado(m) || antes === "danificado") {
        // Devolvido com avaria (com ressalva) ou já com defeito → vai para "Para conserto".
        await db.from("ativos").update({ status: "danificado", alocado_para_tipo: null, alocado_para_id: null, alocado_para_nome: null }).eq("id", a.id);
        await db.from("ativos_movimentos").insert({ ativo_id: a.id, tipo: "devolucao", descricao: antes === "danificado" ? `Devolvido no desligamento de ${colab.nome} (já com defeito registrado)` : `Devolvido COM AVARIA no desligamento de ${colab.nome}${ress ? " (ressalva)" : ""}`, status_anterior: antes, status_novo: "danificado", feito_por: admin.email });
        await cancelarTermos(a.id);
        ativosAvariados++;
      } else {
        await db.from("ativos").update({ status: "em_estoque", alocado_para_tipo: null, alocado_para_id: null, alocado_para_nome: null }).eq("id", a.id);
        await db.from("ativos_movimentos").insert({ ativo_id: a.id, tipo: "devolucao", descricao: `Devolução no desligamento de ${colab.nome}`, status_anterior: antes, status_novo: "em_estoque", feito_por: admin.email });
        await cancelarTermos(a.id);
        ativosDevolvidos++;
      }
    }
    if (ativos.length) {
      const partes = [ativosDevolvidos ? `${ativosDevolvidos} devolvido(s)` : "", ativosAvariados ? `${ativosAvariados} devolvido(s) com avaria` : "", ativosExtraviados ? `${ativosExtraviados} NÃO devolvido(s)/extraviado(s)` : ""].filter(Boolean).join(" · ");
      enviarTelegram(`↩️ <b>Desligamento — itens</b>\n${escTg(colab.nome)}: ${escTg(partes)}.\nPor ${escTg(admin.email)}`).catch(() => { /* best-effort */ });
    }

    // Revoga os acessos a sistemas que ainda estavam ativos (mantém histórico) e
    // monta a lista para o e-mail/checklist da TI.
    const { data: acessosAtivos } = await db.from("rh_acessos").select("id, sistema, usuario").eq("colaborador_id", colaborador_id).eq("status", "ativo");
    const acessosLista = (acessosAtivos || []).map((a: any) => a.sistema + (a.usuario ? ` (${a.usuario})` : ""));
    if (acessosAtivos && acessosAtivos.length) {
      await db.from("rh_acessos").update({ status: "revogado", revogado_em: hoje, updated_at: new Date().toISOString() }).eq("colaborador_id", colaborador_id).eq("status", "ativo");
    }

    // desliga o colaborador (o PATCH já revoga o acesso ao portal)
    const patch: any = { status: "desligado", data_desligamento: dataDesl, updated_at: new Date().toISOString() };
    await db.from("rh_colaboradores").update(patch).eq("id", colaborador_id);
    if (colab.profile_id) {
      await db.from("portal_profiles").update({ approval_status: "rejected" }).eq("id", colab.profile_id);
      await db.from("portal_sessoes").delete().eq("user_id", colab.profile_id);
      await invalidarSessoesPortal(colab.profile_id); // mata o JWT já emitido na hora
    }

    const resumoItens = `${ativosDevolvidos} ativo(s) devolvido(s)${ativosAvariados ? `, ${ativosAvariados} com avaria` : ""}${ativosExtraviados ? `, ${ativosExtraviados} NÃO devolvido(s)/extraviado(s)` : ""} + ${epiPend.length - episNaoDevolvidos} EPI(s) devolvido(s)${episNaoDevolvidos ? `, ${episNaoDevolvidos} EPI(s) NÃO devolvido(s)` : ""}`;
    const todas: any[] = checklistGravar.ressalvas;
    const rescPend = todas.find((r: any) => r && r.rescisao_pendente);
    const txtRessalva = ressalvaReg
      ? ` — COM RESSALVA: ${ressalvaReg.texto}${ressalvaReg.pendencias.length ? ` [pendente: ${ressalvaReg.pendencias.join("; ")}]` : ""}${ressalvaReg.itens_avariados.length ? ` [com avaria: ${ressalvaReg.itens_avariados.join("; ")}]` : ""}`
      : "";
    await registrarAcao(db, { req: request, admin }, { acao: "editar", entidade: "rh_colaboradores", registro_id: colaborador_id, descricao: `Desligou "${colab.nome}" (${resumoItens})${txtRessalva}${rescPend ? " [verbas rescisórias pendentes]" : ""}`, dados: { desligamento_id: desl.id, ativos_extraviados: ativosExtraviados, ressalva: ressalvaReg } });

    enviarTelegram(`👋 <b>Desligamento concluído</b>\n${escTg(colab.nome)}${tipo ? ` · ${escTg(tipo)}` : ""}\n${escTg(resumoItens)}.${ressalvaReg ? `\n⚠️ <b>Com ressalva:</b> ${escTg(ressalvaReg.texto)}` : ""}${rescPend ? "\n💰 Verbas rescisórias pendentes." : ""}`, { canal: "ADM" }).catch(() => { /* best-effort */ });

    // ── Automação: e-mail com o checklist de cancelamentos (do board RH/DP) ──
    try {
      const tarefas = [
        "TI — cancelar acessos (e-mail, ControlID, sistemas)",
        "Banco — cancelar conta salário",
        "Alelo — cancelar cartões (VA/VR)",
        "VT — excluir da plataforma de vale-transporte",
        "Totalpass — excluir o funcionário",
      ];
      if (colab.regime === "clt") tarefas.unshift("Agendar/conferir exame demissional (ASO)");
      const fmtR = (r: any) => `${escHtml(r.texto)}${Array.isArray(r.pendencias) && r.pendencias.length ? `<br>Passos não cumpridos: ${r.pendencias.map(escHtml).join("; ")}` : ""}${Array.isArray(r.itens_avariados) && r.itens_avariados.length ? `<br>Itens devolvidos com avaria: ${r.itens_avariados.map(escHtml).join("; ")}` : ""}${r.rescisao_pendente ? `<br>Verbas rescisórias pendentes${typeof r.valor_rescisao === "number" ? `: R$ ${r.valor_rescisao.toFixed(2).replace(".", ",")}` : ""}${/^\d{4}-\d{2}-\d{2}$/.test(String(r.previsao_rescisao || "")) ? ` (previsão ${String(r.previsao_rescisao).split("-").reverse().join("/")})` : ""}` : ""}`;
      const blocoRess = todas.length
        ? `<div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:10px 12px;margin-top:10px;font-size:14px"><strong>⚠️ Ressalvas registradas:</strong>${todas.map((r) => `<div style="margin-top:6px">• ${fmtR(r)}</div>`).join("")}</div>`
        : "";
      const html = `<div style="font-family:Arial,sans-serif;color:#2D2F36;max-width:640px">
        <h2 style="color:#C41E3A;margin-bottom:4px">🚪 Desligamento concluído — ${escHtml(colab.nome)}</h2>
        <p style="color:#5B5F6B">Regime: <strong>${escHtml((colab.regime || "—").toUpperCase())}</strong> · Data: ${dataDesl.split("-").reverse().join("/")}. O acesso ao portal já foi revogado. Providencie os cancelamentos abaixo:</p>
        <ul style="font-size:14px;line-height:1.9">${tarefas.map((t) => `<li>${escHtml(t)}</li>`).join("")}</ul>
        ${blocoRess}
        ${acessosLista.length ? `<p style="font-weight:700;margin:14px 0 4px;color:#2D2F36">🔐 Acessos cadastrados a revogar/conferir (${acessosLista.length}):</p><ul style="font-size:14px;line-height:1.8">${acessosLista.map((s) => `<li>${escHtml(s)}</li>`).join("")}</ul>` : ""}
        <p style="margin-top:16px"><a href="${SITE_DESL}/admin/rh" style="background:#C41E3A;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:700">Abrir o RH</a></p>
        <p style="color:#9CA3AF;font-size:12px;margin-top:24px">Aviso automático — Costa Júnior Engenharia.</p>
      </div>`;
      for (const to of String(DESLIG_EMAIL).split(",").map((s) => s.trim()).filter(Boolean)) {
        await enviarEmailSimples({ to, subject: `🚪 Desligamento: ${String(colab.nome || "").replace(/[\r\n]+/g, " ")} — cancelamentos a fazer`, html }).catch(() => {});
      }
    } catch { /* o e-mail nunca derruba o desligamento */ }

    return jsonOk({ ok: true, desligamento_id: desl.id });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
