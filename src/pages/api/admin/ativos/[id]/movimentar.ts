import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";
import { enviarEmailSimples } from "../../../../../lib/mailer";
import { enviarTelegram, escTg } from "../../../../../lib/telegram";

export const prerender = false;

const ATIVOS_ALERT_EMAIL = import.meta.env.ATIVOS_ALERT_EMAIL || "adm@costajr.com.br";
const STATUS_VALIDOS = ["em_estoque", "disponivel", "alocado", "em_manutencao", "em_transito", "extraviado", "roubado", "danificado", "baixado", "descartado", "vendido"];
const STATUS_LABEL: Record<string, string> = {
  em_estoque: "Em estoque", disponivel: "Disponível", alocado: "Alocado", em_manutencao: "Em manutenção",
  em_transito: "Em trânsito", extraviado: "Extraviado", roubado: "Roubado", danificado: "Danificado",
  baixado: "Baixado", descartado: "Descartado", vendido: "Vendido",
};
const TIPOS_OCORRENCIA = ["extravio", "roubo", "furto", "dano", "quebra", "sinistro", "outro"];

/**
 * POST /api/admin/ativos/[id]/movimentar
 * Única porta de entrada para mudanças de situação do ativo.
 * Toda ação gera registro permanente em ativos_movimentos (nunca apagado).
 *
 * body.acao:
 *  - entregar          { colaborador_id, colaborador_nome, colaborador_email?, condicao?, observacao? } → termo de responsabilidade
 *  - transferir_obra   { obra_id, obra_nome, condicao?, observacao? }
 *  - devolver          { condicao?, fotos?, observacao? }
 *  - enviar_manutencao { prestador?, motivo?, valor?, observacao? }
 *  - retornar_manutencao { manutencao_id?, data_retorno?, valor?, garantia_servico?, observacao? }
 *  - ocorrencia        { tipo_ocorrencia, data_ocorrencia?, descricao, responsavel?, boletim_ocorrencia_url?, novo_status? }
 *  - mudar_status      { novo_status, observacao? }
 *  - baixar / descartar { observacao? }
 */
export const POST: APIRoute = async ({ request, params, clientAddress }) => {
  try {
    const admin = await requireAdminCookie(request);
    const id = params.id!;
    const body = await request.json();
    const acao = body.acao as string;
    const db = supabaseAdmin();

    const { data: ativo } = await db.from("ativos").select("*").eq("id", id).maybeSingle();
    if (!ativo) return jsonErr(404, "Ativo não encontrado");

    const ident = `${ativo.descricao}${ativo.numero_patrimonial ? ` (pat. ${ativo.numero_patrimonial})` : ""}`;
    const agora = new Date().toISOString();

    async function aplicar(patchAtivo: Record<string, unknown>, movimento: Record<string, unknown>) {
      const { error: e1 } = await db.from("ativos").update({ ...patchAtivo, updated_at: agora }).eq("id", id);
      if (e1) throw new Error(e1.message);
      const { data: mov, error: e2 } = await db.from("ativos_movimentos").insert({
        ativo_id: id,
        status_anterior: ativo.status,
        feito_por: admin.email,
        ...movimento,
      }).select().single();
      if (e2) throw new Error(e2.message);
      // E-mail ao ADM sempre que o STATUS do ativo mudar (não bloqueia a ação)
      const antes = mov.status_anterior as string | null;
      const depois = mov.status_novo as string | null;
      if (depois && antes !== depois) {
        const lAntes = STATUS_LABEL[antes || ""] || antes || "—";
        const lDepois = STATUS_LABEL[depois] || depois;
        enviarEmailSimples({
          to: ATIVOS_ALERT_EMAIL,
          subject: `Ativo: ${ident} → ${lDepois}`,
          html: `<div style="font-family:Arial,sans-serif;color:#2D2F36;max-width:620px">
            <h2 style="color:#C41E3A;margin:0 0 6px">Mudança de status de ativo</h2>
            <p style="margin:0 0 10px"><strong>${ident}</strong></p>
            <p style="margin:0 0 4px">Status: <strong>${lAntes}</strong> → <strong style="color:#C41E3A">${lDepois}</strong></p>
            <p style="margin:0 0 4px;color:#5B5F6B;font-size:14px">${String(mov.descricao || "")}</p>
            <p style="margin:0;color:#9CA3AF;font-size:12px">Por ${admin.email} em ${new Date().toLocaleString("pt-BR")}.</p>
          </div>`,
        }).catch(() => { /* e-mail é best-effort */ });
        // espelha o aviso no grupo do Telegram (best-effort)
        enviarTelegram(
          `🏷️ <b>Ativo — mudança de status</b>\n${escTg(ident)}\n${escTg(lAntes)} → <b>${escTg(lDepois)}</b>\n<i>${escTg(String(mov.descricao || ""))}</i>\nPor ${escTg(admin.email)}`
        ).catch(() => { /* best-effort */ });
      }
      return mov;
    }

    switch (acao) {
      case "entregar": {
        const { colaborador_id, colaborador_nome, colaborador_email, condicao, observacao } = body;
        // colaborador_id agora é o ID da PESSOA do RH (rh_colaboradores). Buscamos a pessoa
        // p/ gravar o nome correto e descobrir o login (profile_id) que assina o termo.
        let alocId: string | null = null;   // dono do equipamento = pessoa do RH
        let profileId: string | null = null; // login que aceita o termo (FK -> portal_profiles)
        let nome = colaborador_nome;
        let email = colaborador_email || null;
        if (colaborador_id) {
          const { data: colab } = await db.from("rh_colaboradores").select("id, nome, email, profile_id").eq("id", colaborador_id).maybeSingle();
          if (colab) { alocId = colab.id; profileId = colab.profile_id || null; nome = colab.nome || nome; email = colab.email || email; }
          else { alocId = colaborador_id; } // caso não seja um RH conhecido, mantém o id informado
        }
        if (!nome) return jsonErr(400, "Informe o colaborador");
        const mov = await aplicar(
          { status: "alocado", alocado_para_tipo: "colaborador", alocado_para_id: alocId, alocado_para_nome: nome },
          {
            tipo: "entrega",
            descricao: `Entregue para ${nome}${observacao ? ` — ${observacao}` : ""}`,
            de_tipo: ativo.alocado_para_tipo, de_id: ativo.alocado_para_id, de_nome: ativo.alocado_para_nome,
            para_tipo: "colaborador", para_id: alocId, para_nome: nome,
            status_novo: "alocado", condicao: condicao || null,
          }
        );

        // Termo de responsabilidade gerado automaticamente
        const conteudo = gerarTermo(ativo, { nome, email: email || undefined }, condicao, admin.email);
        const { data: termo, error: e3 } = await db.from("ativos_termos").insert({
          ativo_id: id, movimento_id: mov.id,
          colaborador_id: profileId,
          colaborador_nome: nome, colaborador_email: email,
          conteudo, condicao: condicao || null,
          criado_por: admin.email,
        }).select().single();
        if (e3) return jsonErr(400, e3.message);
        await registrarAcao(db, { req: request, admin }, {
          acao: "criar",
          entidade: "ativos_termos",
          registro_id: termo.id,
          descricao: `Entregou ativo ${ident} para ${nome} (termo de responsabilidade gerado)`,
          dados: termo,
        });
        return jsonOk({ movimento: mov, termo });
      }

      case "transferir_obra": {
        const { obra_id, obra_nome, condicao, observacao } = body;
        if (!obra_nome) return jsonErr(400, "Informe a obra");
        const mov = await aplicar(
          { status: "alocado", alocado_para_tipo: "obra", alocado_para_id: obra_id || null, alocado_para_nome: obra_nome },
          {
            tipo: "transferencia",
            descricao: `Transferido para obra ${obra_nome}${observacao ? ` — ${observacao}` : ""}`,
            de_tipo: ativo.alocado_para_tipo, de_id: ativo.alocado_para_id, de_nome: ativo.alocado_para_nome,
            para_tipo: "obra", para_id: obra_id || null, para_nome: obra_nome,
            status_novo: "alocado", condicao: condicao || null,
          }
        );
        return jsonOk({ movimento: mov });
      }

      case "transferir_deposito": {
        // Guardar em depósito = volta para estoque, mas com o local registrado.
        // NÃO gera termo de responsabilidade (não é posse de pessoa).
        const { deposito_id, deposito_nome, condicao, observacao } = body;
        let depId = deposito_id || null;
        let depNome = deposito_nome || null;
        if (depId) {
          const { data: dep } = await db.from("depositos").select("id, nome, ativo").eq("id", depId).maybeSingle();
          if (dep) depNome = dep.nome;
        }
        if (!depNome) return jsonErr(400, "Informe o depósito");
        const mov = await aplicar(
          { status: "em_estoque", alocado_para_tipo: "deposito", alocado_para_id: depId, alocado_para_nome: depNome },
          {
            tipo: "transferencia",
            descricao: `Guardado no depósito ${depNome}${observacao ? ` — ${observacao}` : ""}`,
            de_tipo: ativo.alocado_para_tipo, de_id: ativo.alocado_para_id, de_nome: ativo.alocado_para_nome,
            para_tipo: "deposito", para_id: depId, para_nome: depNome,
            status_novo: "em_estoque", condicao: condicao || null,
          }
        );
        return jsonOk({ movimento: mov });
      }

      case "devolver": {
        const { condicao, fotos, observacao } = body;
        const mov = await aplicar(
          { status: "em_estoque", alocado_para_tipo: null, alocado_para_id: null, alocado_para_nome: null },
          {
            tipo: "devolucao",
            descricao: `Devolvido ao estoque${ativo.alocado_para_nome ? ` por ${ativo.alocado_para_nome}` : ""}${observacao ? ` — ${observacao}` : ""}`,
            de_tipo: ativo.alocado_para_tipo, de_id: ativo.alocado_para_id, de_nome: ativo.alocado_para_nome,
            status_novo: "em_estoque", condicao: condicao || null, fotos: fotos || [],
          }
        );
        // equipamento devolvido → cancela os termos em aberto deste ativo
        if (ativo.alocado_para_tipo === "colaborador") {
          await db.from("ativos_termos").update({ status: "cancelado" })
            .eq("ativo_id", id).neq("status", "cancelado");
        }
        return jsonOk({ movimento: mov });
      }

      case "enviar_manutencao": {
        const { prestador, motivo, valor, observacao } = body;
        const { data: manut, error: eM } = await db.from("ativos_manutencoes").insert({
          ativo_id: id, data_envio: agora.slice(0, 10),
          prestador: prestador || null, motivo: motivo || null, valor: valor || null,
          criado_por: admin.email,
        }).select().single();
        if (eM) return jsonErr(400, eM.message);
        const mov = await aplicar(
          { status: "em_manutencao" },
          {
            tipo: "envio_manutencao",
            descricao: `Enviado para manutenção${prestador ? ` (${prestador})` : ""}${motivo ? ` — ${motivo}` : ""}${observacao ? ` — ${observacao}` : ""}`,
            status_novo: "em_manutencao",
            dados: { manutencao_id: manut.id },
          }
        );
        return jsonOk({ movimento: mov, manutencao: manut });
      }

      case "retornar_manutencao": {
        const { manutencao_id, data_retorno, valor, garantia_servico, observacao } = body;
        if (manutencao_id) {
          await db.from("ativos_manutencoes").update({
            status: "concluida",
            data_retorno: data_retorno || agora.slice(0, 10),
            ...(valor != null && valor !== "" ? { valor } : {}),
            ...(garantia_servico ? { garantia_servico } : {}),
          }).eq("id", manutencao_id);
        }
        // Se o ativo ainda tinha alocação (não foi devolvido antes de ir p/ manutenção),
        // restaura para quem o usava; senão volta pro estoque.
        const tinhaAlocacao = !!ativo.alocado_para_nome;
        const statusRetorno = tinhaAlocacao ? "alocado" : "em_estoque";
        const mov = await aplicar(
          tinhaAlocacao ? { status: "alocado" } : { status: "em_estoque", alocado_para_tipo: null, alocado_para_id: null, alocado_para_nome: null },
          {
            tipo: "retorno_manutencao",
            descricao: tinhaAlocacao
              ? `Retornou da manutenção para ${ativo.alocado_para_nome}${observacao ? ` — ${observacao}` : ""}`
              : `Retornou da manutenção ao estoque${observacao ? ` — ${observacao}` : ""}`,
            status_novo: statusRetorno,
            dados: { manutencao_id: manutencao_id || null },
          }
        );
        return jsonOk({ movimento: mov });
      }

      case "ocorrencia": {
        const { tipo_ocorrencia, data_ocorrencia, descricao, responsavel, boletim_ocorrencia_url, novo_status } = body;
        if (!tipo_ocorrencia || !descricao) return jsonErr(400, "Tipo e descrição da ocorrência são obrigatórios");
        if (!TIPOS_OCORRENCIA.includes(tipo_ocorrencia)) return jsonErr(400, "Tipo de ocorrência inválido");
        if (novo_status && !STATUS_VALIDOS.includes(novo_status)) return jsonErr(400, "Status inválido");
        const { data: oc, error: eO } = await db.from("ativos_ocorrencias").insert({
          ativo_id: id, tipo: tipo_ocorrencia,
          data_ocorrencia: data_ocorrencia || agora.slice(0, 10),
          descricao, responsavel: responsavel || null,
          boletim_ocorrencia_url: boletim_ocorrencia_url || null,
          criado_por: admin.email,
        }).select().single();
        if (eO) return jsonErr(400, eO.message);

        const statusMap: Record<string, string> = { extravio: "extraviado", roubo: "roubado", furto: "roubado", dano: "danificado", quebra: "danificado", sinistro: "danificado" };
        const statusFinal = novo_status || statusMap[tipo_ocorrencia] || ativo.status;
        const mov = await aplicar(
          { status: statusFinal },
          {
            tipo: "ocorrencia",
            descricao: `Ocorrência (${tipo_ocorrencia}): ${descricao}`,
            status_novo: statusFinal,
            dados: { ocorrencia_id: oc.id },
          }
        );
        return jsonOk({ movimento: mov, ocorrencia: oc });
      }

      case "mudar_status": {
        const { novo_status, observacao, valor_venda } = body;
        if (!novo_status) return jsonErr(400, "Informe o novo status");
        if (!STATUS_VALIDOS.includes(novo_status)) return jsonErr(400, "Status inválido");
        const patch: Record<string, unknown> = { status: novo_status };
        let extra = "";
        if (novo_status === "vendido") {
          const v = valor_venda != null && valor_venda !== "" ? Number(valor_venda) : null;
          if (v != null && (isNaN(v) || v < 0)) return jsonErr(400, "Valor da venda inválido.");
          patch.valor_venda = v;
          patch.data_venda = agora.slice(0, 10);
          patch.alocado_para_tipo = null; patch.alocado_para_id = null; patch.alocado_para_nome = null;
          extra = v != null ? ` — venda R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : "";
        }
        const mov = await aplicar(patch, {
          tipo: "mudanca_status",
          descricao: `Status alterado de "${STATUS_LABEL[ativo.status] || ativo.status}" para "${STATUS_LABEL[novo_status] || novo_status}"${observacao ? ` — ${observacao}` : ""}${extra}`,
          status_novo: novo_status,
        });
        return jsonOk({ movimento: mov });
      }

      case "baixar":
      case "descartar": {
        const { observacao } = body;
        const statusFinal = acao === "baixar" ? "baixado" : "descartado";
        const mov = await aplicar(
          { status: statusFinal, alocado_para_tipo: null, alocado_para_id: null, alocado_para_nome: null },
          {
            tipo: acao === "baixar" ? "baixa" : "descarte",
            descricao: `${acao === "baixar" ? "Baixa" : "Descarte"} do ativo ${ident}${observacao ? ` — ${observacao}` : ""}`,
            status_novo: statusFinal,
          }
        );
        return jsonOk({ movimento: mov });
      }

      default:
        return jsonErr(400, `Ação inválida: ${acao}`);
    }
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

function gerarTermo(ativo: any, colaborador: { nome: string; email?: string }, condicao: string | undefined, emitidoPor: string): string {
  const hoje = new Date().toLocaleDateString("pt-BR");
  const linhas = [
    "TERMO DE RESPONSABILIDADE DE USO DE EQUIPAMENTO",
    "",
    "COSTA JÚNIOR ENGENHARIA E CONSTRUÇÕES",
    "",
    `Colaborador(a): ${colaborador.nome}${colaborador.email ? ` (${colaborador.email})` : ""}`,
    `Data de entrega: ${hoje}`,
    "",
    "EQUIPAMENTO:",
    `  Descrição: ${ativo.descricao}`,
    ativo.marca || ativo.modelo ? `  Marca/Modelo: ${[ativo.marca, ativo.modelo].filter(Boolean).join(" / ")}` : null,
    ativo.numero_serie ? `  Nº de série: ${ativo.numero_serie}` : null,
    ativo.numero_patrimonial ? `  Nº patrimonial: ${ativo.numero_patrimonial}` : null,
    ativo.campos?.imei1 ? `  IMEI 1: ${ativo.campos.imei1}` : null,
    ativo.campos?.imei2 ? `  IMEI 2: ${ativo.campos.imei2}` : null,
    ativo.campos?.placa ? `  Placa: ${ativo.campos.placa}` : null,
    condicao ? `  Estado de conservação na entrega: ${condicao}` : null,
    "",
    "DECLARAÇÃO:",
    "Declaro que recebi o equipamento acima descrito, em perfeitas condições de uso",
    "(salvo observações registradas), comprometendo-me a:",
    "  1. Utilizá-lo exclusivamente para atividades profissionais da empresa;",
    "  2. Zelar pela sua guarda, conservação e bom funcionamento;",
    "  3. Comunicar imediatamente qualquer dano, defeito, perda, roubo ou furto;",
    "  4. Devolvê-lo quando solicitado, ao término do contrato de trabalho ou desligamento;",
    "  5. Ressarcir a empresa em caso de dano ou perda decorrente de mau uso, conforme art. 462, §1º da CLT.",
    "",
    `Termo emitido por ${emitidoPor} em ${hoje}.`,
    "O aceite eletrônico deste termo, realizado no Portal do Colaborador mediante login e senha pessoais,",
    "tem validade como assinatura, registrando data, hora e endereço IP do aceite.",
  ].filter((l): l is string => l !== null);
  return linhas.join("\n");
}
