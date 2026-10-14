import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr, type AdminClaims } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";
import { bloqueioSeSoLeitura } from "../../../../../lib/permissoes";
import { ROTULO_TIPO_REAVER, ROTULO_CHANCE } from "../../../../../lib/situacaoFinanceira";
import {
  msgDe, erroDeAcesso, erroDoBanco, lerId, lerCorpo, brl, dataBR, hojeSP,
  CAMPOS_REAVER, ROTULO_CAMPO_REAVER, lerCamposReaver, type CampoReaver,
} from "../../../../../lib/situacaoFinanceiraApi";

export const prerender = false;

// PATCH  /api/admin/situacao-financeira/reaver/<id>  — edita UM item de "A reaver" (fin_sf_reaver, migration 119)
//   Corpo (JSON, pelo menos 1 campo): { tipo, titulo, contraparte, valor_estimado, chance, situacao, previsao,
//   fonte, observacao, recebido, recebido_em, valor_recebido, ordem }
//   recebido=true sem data → recebido_em = hoje (São Paulo). Desmarcar mantém data e valor (histórico).
// DELETE /api/admin/situacao-financeira/reaver/<id>  — remove da tela (soft: ativo=false; a linha fica no banco).
//   O cliente manda content-type application/json (CSRF do Astro), o corpo é ignorado.
const MODULO = "situacao-financeira";
const TABELA = "fin_sf_reaver";
const NUMERICOS: readonly CampoReaver[] = ["valor_estimado", "valor_recebido", "ordem"];

async function autenticar(request: Request): Promise<{ ok: true; admin: AdminClaims } | { ok: false; res: Response }> {
  let admin: AdminClaims;
  try {
    admin = await requireAdminCookie(request);
  } catch (e) {
    return { ok: false, res: erroDeAcesso(e) };
  }
  try {
    const ro = await bloqueioSeSoLeitura(admin, MODULO);
    if (ro) return { ok: false, res: ro };
  } catch (e) {
    return { ok: false, res: jsonErr(500, "Não consegui conferir a sua permissão agora. Tente de novo em instantes.", msgDe(e)) };
  }
  return { ok: true, admin };
}

function rotuloValor(k: CampoReaver, v: unknown): string {
  if (v == null || v === "") return "—";
  if (k === "valor_estimado" || k === "valor_recebido") return brl(v);
  if (k === "recebido_em") return dataBR(v);
  if (k === "tipo") return (ROTULO_TIPO_REAVER as Record<string, string>)[String(v)] || String(v);
  if (k === "chance") return (ROTULO_CHANCE as Record<string, string>)[String(v)] || String(v);
  return String(v);
}

export const PATCH: APIRoute = async ({ request, params }) => {
  const au = await autenticar(request);
  if (!au.ok) return au.res;
  const admin = au.admin;

  const id = lerId(params.id);
  if (!id) return jsonErr(400, "Identificador do item inválido.");

  const corpo = await lerCorpo(request);
  if (!corpo.ok) return jsonErr(corpo.status, corpo.erro);
  const b = corpo.v;

  const chaves = Object.keys(b);
  const extras = chaves.filter((k) => !(CAMPOS_REAVER as readonly string[]).includes(k));
  if (extras.length) {
    return jsonErr(400, `Campo não aceito: ${extras.join(", ")}. Nesta tela só dá para alterar: ${CAMPOS_REAVER.join(", ")}.`);
  }
  if (!chaves.length) return jsonErr(400, `Nada para atualizar: envie pelo menos um campo (${CAMPOS_REAVER.join(", ")}).`);

  const lidos = lerCamposReaver(b);
  if (!lidos.ok) return jsonErr(400, lidos.erro);
  const upd: Record<string, unknown> = { ...lidos.v };
  if ("titulo" in upd && !upd.titulo) return jsonErr(400, "O título não pode ficar vazio.");
  if ("tipo" in upd && !upd.tipo) return jsonErr(400, "Informe o tipo.");

  const db = supabaseAdmin();
  const { data: antes, error: e1 } = await db.from(TABELA).select("*").eq("id", id).maybeSingle();
  if (e1) return erroDoBanco(e1);
  if (!antes || (antes as { ativo?: unknown }).ativo === false) {
    return jsonErr(404, "Item não encontrado. Ele pode ter sido removido; recarregue a página.");
  }
  const A = antes as Record<string, unknown>;

  // marcou como recebido sem data: mantém a data que já existia (se já estava recebido) ou usa hoje
  let dataPadrao = false;
  if (upd.recebido === true && !upd.recebido_em) {
    upd.recebido_em = A.recebido === true && typeof A.recebido_em === "string" && A.recebido_em ? A.recebido_em : hojeSP();
    dataPadrao = true;
  }

  upd.updated_at = new Date().toISOString();
  upd.atualizado_por = admin.email || null;
  const { data, error } = await db.from(TABELA).update(upd).eq("id", id).select("*").maybeSingle();
  if (error) return erroDoBanco(error);
  if (!data) return jsonErr(404, "Item não encontrado. Ele pode ter sido removido; recarregue a página.");
  const D = data as Record<string, unknown>;

  // log: o que mudou, em português
  const enviados = (dataPadrao && !chaves.includes("recebido_em") ? [...chaves, "recebido_em"] : chaves) as CampoReaver[];
  const igual = (k: CampoReaver) => (NUMERICOS.includes(k)
    ? (A[k] == null ? null : Number(A[k])) === (D[k] == null ? null : Number(D[k]))
    : A[k] === D[k]);
  const partes = enviados.filter((k) => !igual(k)).map((k) => {
    if (k === "recebido") {
      return D.recebido === true
        ? `marcou como RECEBIDO (${brl(D.valor_recebido ?? D.valor_estimado)} em ${dataBR(D.recebido_em)})`
        : "desmarcou o recebimento (voltou para a reaver)";
    }
    if (["situacao", "fonte", "observacao"].includes(k)) return `${ROTULO_CAMPO_REAVER[k]} alterada`;
    return `${ROTULO_CAMPO_REAVER[k]}: ${rotuloValor(k, A[k])} → ${rotuloValor(k, D[k])}`;
  });
  await registrarAcao(db, { req: request, admin }, {
    acao: "editar",
    entidade: TABELA,
    registro_id: id,
    descricao: `Situação Financeira — A reaver "${String(D.titulo || id).slice(0, 120)}": ${partes.length ? partes.join("; ") : "salvo sem mudanças"}`,
    dados: {
      antes: Object.fromEntries(enviados.map((k) => [k, A[k] ?? null])),
      depois: Object.fromEntries(enviados.map((k) => [k, D[k] ?? null])),
    },
  });

  return jsonOk(data);
};

export const DELETE: APIRoute = async ({ request, params }) => {
  const au = await autenticar(request);
  if (!au.ok) return au.res;
  const admin = au.admin;

  const id = lerId(params.id);
  if (!id) return jsonErr(400, "Identificador do item inválido.");
  // mesma regra do POST/PATCH (lerCorpo): mutação só com content-type JSON (CSRF do Astro); o corpo é ignorado
  const ct = (request.headers.get("content-type") || "").toLowerCase();
  if (!ct.includes("application/json")) {
    return jsonErr(415, "Envie os dados em JSON (cabeçalho content-type: application/json).");
  }

  const db = supabaseAdmin();
  const { data: antes, error: e1 } = await db.from(TABELA).select("*").eq("id", id).maybeSingle();
  if (e1) return erroDoBanco(e1);
  if (!antes) return jsonErr(404, "Item não encontrado. Ele pode já ter sido removido; recarregue a página.");
  const A = antes as Record<string, unknown>;
  if (A.ativo === false) return jsonOk({ ok: true, id, jaRemovido: true });

  const { error } = await db.from(TABELA)
    .update({ ativo: false, updated_at: new Date().toISOString(), atualizado_por: admin.email || null })
    .eq("id", id);
  if (error) return erroDoBanco(error);

  await registrarAcao(db, { req: request, admin }, {
    acao: "excluir",
    entidade: TABELA,
    registro_id: id,
    descricao: `Situação Financeira — A reaver: removeu "${String(A.titulo || id).slice(0, 120)}" da lista (fica no banco com ativo=false)`,
    dados: { antes: A },
  });

  return jsonOk({ ok: true, id });
};
