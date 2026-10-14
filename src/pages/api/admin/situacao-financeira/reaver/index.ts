import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr, type AdminClaims } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";
import { bloqueioSeSoLeitura } from "../../../../../lib/permissoes";
import { ROTULO_TIPO_REAVER } from "../../../../../lib/situacaoFinanceira";
import {
  msgDe, erroDeAcesso, erroDoBanco, lerCorpo, brl, hojeSP, CAMPOS_REAVER, lerCamposReaver,
} from "../../../../../lib/situacaoFinanceiraApi";

export const prerender = false;

// POST /api/admin/situacao-financeira/reaver
// Cria UM item da lista "A reaver" (tabela fin_sf_reaver, migration 119): dinheiro ou crédito que pode voltar
// (processos, créditos tributários, consórcios, outros).
// Corpo (JSON): { tipo, titulo (obrigatório), contraparte, valor_estimado, chance, situacao, previsao, fonte,
//                 observacao, recebido, recebido_em, valor_recebido, ordem }
//   tipo: processo | credito_tributario | consorcio | outro (padrão: outro)
//   chance: alta | media | baixa | nao_sei (ou null)
//   recebido=true sem data → recebido_em = hoje (São Paulo). Sem ordem → vai para o fim da lista.
// A trava central do middleware já cobre esta rota: moduloDaRotaApi("/api/admin/situacao-financeira/...")
// = "situacao-financeira". Mesmo assim confere aqui (padrão das outras rotas).
const MODULO = "situacao-financeira";
const TABELA = "fin_sf_reaver";

export const POST: APIRoute = async ({ request }) => {
  let admin: AdminClaims;
  try {
    admin = await requireAdminCookie(request);
  } catch (e) {
    return erroDeAcesso(e);
  }
  try {
    const ro = await bloqueioSeSoLeitura(admin, MODULO);
    if (ro) return ro;
  } catch (e) {
    return jsonErr(500, "Não consegui conferir a sua permissão agora. Tente de novo em instantes.", msgDe(e));
  }

  const corpo = await lerCorpo(request);
  if (!corpo.ok) return jsonErr(corpo.status, corpo.erro);
  const b = corpo.v;

  const extras = Object.keys(b).filter((k) => !(CAMPOS_REAVER as readonly string[]).includes(k));
  if (extras.length) {
    return jsonErr(400, `Campo não aceito: ${extras.join(", ")}. Campos aceitos: ${CAMPOS_REAVER.join(", ")}.`);
  }

  const lidos = lerCamposReaver(b);
  if (!lidos.ok) return jsonErr(400, lidos.erro);
  const ins: Record<string, unknown> = { ...lidos.v };
  if (!ins.titulo) return jsonErr(400, "Informe o título (ex.: \"Processo contra a seguradora\").");
  if (!ins.tipo) ins.tipo = "outro";
  if (ins.recebido === true && !ins.recebido_em) ins.recebido_em = hojeSP();

  const db = supabaseAdmin();
  if (ins.ordem == null) {
    const { data: ult, error: eo } = await db.from(TABELA).select("ordem")
      .order("ordem", { ascending: false, nullsFirst: false }).limit(1);
    if (eo) return erroDoBanco(eo);
    const maior = Array.isArray(ult) && ult.length ? Number((ult[0] as { ordem?: unknown }).ordem) : 0;
    ins.ordem = (Number.isFinite(maior) ? maior : 0) + 1;
  }
  ins.ativo = true;
  ins.updated_at = new Date().toISOString();
  ins.atualizado_por = admin.email || null;

  const { data, error } = await db.from(TABELA).insert(ins).select("*").maybeSingle();
  if (error) return erroDoBanco(error);
  if (!data) return jsonErr(500, "O item não foi criado. Tente de novo em instantes.");
  const D = data as Record<string, unknown>;

  const tipo = String(D.tipo || "");
  const rotuloTipo = (ROTULO_TIPO_REAVER as Record<string, string>)[tipo] || tipo;
  await registrarAcao(db, { req: request, admin }, {
    acao: "criar",
    entidade: TABELA,
    registro_id: String(D.id),
    descricao: `Situação Financeira — A reaver: incluiu "${String(D.titulo).slice(0, 120)}" (${rotuloTipo}${D.valor_estimado != null ? `, ${brl(D.valor_estimado)}` : ""})`,
    dados: { depois: D },
  });

  return jsonOk(data, 201);
};
