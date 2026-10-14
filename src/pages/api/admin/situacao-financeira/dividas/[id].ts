import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr, type AdminClaims } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";
import { bloqueioSeSoLeitura } from "../../../../../lib/permissoes";
import { lerData, lerBool, hojeSP, dataBR } from "../../../../../lib/situacaoFinanceiraApi";
import { COBRANCAS, ROTULO_COBRANCA } from "../../../../../lib/situacaoFinanceira";

export const prerender = false;

// PATCH /api/admin/situacao-financeira/dividas/<id>
// Atualiza UMA dívida do quadro (tabela fin_sf_dividas, migrations 118, 119 e 120).
// Corpo (JSON, todos opcionais, pelo menos 1):
//   { situacao, valor, valor_teto, parcela_mensal, observacao, risco,
//     valor_proposta, proposta_obs, quitada, quitada_em, valor_pago,
//     valor_a_vencer, proximo_vencimento, cobranca, comprometida_cortada, cortada_em, vobi_fornecedor_id }
//   valores em reais: número >= 0, ou null para apagar (aceita também "1234,56" ou "1.234,56").
//   valor = SÓ O VENCIDO (é o que conta como dívida, desde a migration 120); valor_a_vencer = parcelas futuras
//   (despesa comprometida, fora da dívida); proximo_vencimento = AAAA-MM-DD ou null.
//   Com a vencer > 0, o próximo vencimento não pode estar no passado (o que venceu é VENCIDO, vai em "valor"):
//   recusa com 400 (só confere quando um dos dois vem no corpo; linha quitada não confere).
//   Linha ABERTA com valor_pago = o que já foi pago do vencido ("✓ Paguei o vencido": ela segue com o a vencer).
//   vobi_fornecedor_id: nº do fornecedor na Vobi (inteiro > 0) ou null — liga a linha ao "Atualizar da Vobi"
//   (só faz sentido se TODA a dívida da linha estiver lançada na Vobi).
//   cobranca: "com_cobranca" | "sem_cobranca" | null (null = a tela deduz pela situação).
//   quitada: true/false. Ao marcar quitada=true sem data, quitada_em = hoje (São Paulo).
//   Desmarcar (quitada=false) NÃO apaga quitada_em/valor_pago: o histórico do que foi digitado fica.
//   comprometida_cortada: true/false ("não vai acontecer"). true sem data → cortada_em = hoje (São Paulo)
//   (ou a data que já existia). Desfazer (false) NÃO apaga cortada_em.
const MODULO = "situacao-financeira";
const TABELA = "fin_sf_dividas";
const CAMPOS = [
  "situacao", "valor", "valor_teto", "parcela_mensal", "observacao", "risco",
  "valor_proposta", "proposta_obs", "quitada", "quitada_em", "valor_pago",
  "valor_a_vencer", "proximo_vencimento", "cobranca", "comprometida_cortada", "cortada_em", "vobi_fornecedor_id",
] as const;
type Campo = (typeof CAMPOS)[number];
const ROTULO: Record<Campo, string> = {
  situacao: "situação", valor: "vencido (dívida)", valor_teto: "valor máximo (teto)", parcela_mensal: "parcela mensal",
  observacao: "observação", risco: "risco", valor_proposta: "proposta de quitação", proposta_obs: "observação da proposta",
  quitada: "quitada", quitada_em: "data da quitação", valor_pago: "valor pago",
  valor_a_vencer: "a vencer (comprometido)", proximo_vencimento: "próximo vencimento", cobranca: "cobrança",
  comprometida_cortada: "despesa comprometida cortada", cortada_em: "data do corte",
  vobi_fornecedor_id: "fornecedor na Vobi",
};
const NUMERICOS = ["valor", "valor_teto", "parcela_mensal", "valor_proposta", "valor_pago", "valor_a_vencer"] as const;
const DATAS = ["quitada_em", "proximo_vencimento", "cortada_em"] as const;
function rotuloCobranca(v: unknown): string {
  return v == null || v === "" ? "automática (pela situação)" : ((ROTULO_COBRANCA as Record<string, string>)[String(v)] || String(v)).toLowerCase();
}
const MAX_SITUACAO = 1000;
const MAX_RISCO = 1000;
const MAX_OBS = 4000;
const MAX_PROPOSTA_OBS = 1000;
const MAX_VALOR = 1_000_000_000_000; // R$ 1 trilhão: acima disso é erro de digitação
const MAX_CORPO = 20000;

// ───────────────────────── utilitários (iguais nas 3 rotas de edição) ─────────────────────────
type Res<T> = { ok: true; v: T } | { ok: false; erro: string };

function msgDe(e: unknown): string {
  return String((e as { message?: unknown } | null)?.message ?? e ?? "");
}

function erroDeAcesso(e: unknown): Response {
  const m = msgDe(e);
  const code = String((e as { code?: unknown } | null)?.code ?? "");
  if (m === "Sem permissão") return jsonErr(403, "Você não tem permissão para alterar esta área.");
  if (m === "Não autenticado" || m === "Token inválido" || code.startsWith("ERR_JW")) {
    return jsonErr(401, "Sua sessão expirou ou não é válida. Entre de novo no painel.");
  }
  return jsonErr(500, "Não consegui conferir o seu acesso agora. Tente de novo em instantes.", m);
}

function erroDoBanco(err: { message?: string; code?: string } | null): Response {
  const m = err?.message || "";
  const code = err?.code || "";
  if (["42P01", "42703", "PGRST204", "PGRST205"].includes(code) || /does not exist|schema cache|Could not find the table/i.test(m)) {
    return jsonErr(503, "As tabelas da Situação Financeira ainda não estão completas no banco (migrations 118, 119 e 120). Peça para rodar as migrations e tente de novo.");
  }
  return jsonErr(500, "Não consegui salvar agora. Tente de novo em instantes.", m);
}

function lerId(raw: string | undefined): string | null {
  const id = String(raw ?? "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(id) ? id : null;
}

async function lerCorpo(request: Request): Promise<{ ok: true; v: Record<string, unknown> } | { ok: false; status: number; erro: string }> {
  const ct = (request.headers.get("content-type") || "").toLowerCase();
  if (!ct.includes("application/json")) {
    return { ok: false, status: 415, erro: "Envie os dados em JSON (cabeçalho content-type: application/json)." };
  }
  let txt: string;
  try { txt = await request.text(); } catch { return { ok: false, status: 400, erro: "Não consegui ler os dados enviados." }; }
  if (txt.length > MAX_CORPO) return { ok: false, status: 413, erro: "Os dados enviados são grandes demais." };
  let b: unknown;
  try { b = JSON.parse(txt); } catch { return { ok: false, status: 400, erro: "Os dados enviados não são um JSON válido." }; }
  if (!b || typeof b !== "object" || Array.isArray(b)) {
    return { ok: false, status: 400, erro: "Os dados enviados precisam ser um objeto JSON, ex.: {\"valor\": 1234.56}." };
  }
  return { ok: true, v: b as Record<string, unknown> };
}

/** Texto opcional: null/"" viram null; aparo nas pontas; limite de tamanho. */
function lerTexto(v: unknown, rotulo: string, max: number): Res<string | null> {
  if (v === null) return { ok: true, v: null };
  if (typeof v !== "string") return { ok: false, erro: `O campo "${rotulo}" precisa ser um texto.` };
  const t = v.replace(/\u0000/g, "").trim();
  if (!t) return { ok: true, v: null };
  if (t.length > max) return { ok: false, erro: `O campo "${rotulo}" pode ter no máximo ${max} caracteres (veio com ${t.length}).` };
  return { ok: true, v: t };
}

/** Valor em reais >= 0, com 2 casas; null/"" apagam. Aceita número ou texto "1234.56", "1234,56", "1.234,56", "R$ 1.234,56". */
function lerValor(v: unknown, rotulo: string): Res<number | null> {
  if (v === null || v === "") return { ok: true, v: null };
  let n: number;
  if (typeof v === "number") {
    n = v;
  } else if (typeof v === "string") {
    const s = v.trim().replace(/^R\$\s*/i, "");
    if (/^-/.test(s)) return { ok: false, erro: `O campo "${rotulo}" não pode ser negativo.` };
    if (/^\d+([.,]\d{1,2})?$/.test(s)) n = Number(s.replace(",", "."));
    else if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) n = Number(s.replace(/\./g, "").replace(",", "."));
    else return { ok: false, erro: `Valor inválido em "${rotulo}": use só números, ex.: 1234,56.` };
  } else {
    return { ok: false, erro: `O campo "${rotulo}" precisa ser um número (ou vazio para apagar).` };
  }
  if (!Number.isFinite(n)) return { ok: false, erro: `Valor inválido em "${rotulo}".` };
  if (n < 0) return { ok: false, erro: `O campo "${rotulo}" não pode ser negativo.` };
  if (n > MAX_VALOR) return { ok: false, erro: `O valor em "${rotulo}" é alto demais; confira a digitação.` };
  return { ok: true, v: Math.round(n * 100) / 100 };
}

function brl(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return "R$ " + n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ───────────────────────── rota ─────────────────────────
export const PATCH: APIRoute = async ({ request, params }) => {
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

  const id = lerId(params.id);
  if (!id) return jsonErr(400, "Identificador da dívida inválido.");

  const corpo = await lerCorpo(request);
  if (!corpo.ok) return jsonErr(corpo.status, corpo.erro);
  const b = corpo.v;

  const chaves = Object.keys(b);
  const extras = chaves.filter((k) => !(CAMPOS as readonly string[]).includes(k));
  if (extras.length) {
    return jsonErr(400, `Campo não aceito: ${extras.join(", ")}. Nesta tela só dá para alterar: ${CAMPOS.join(", ")}.`);
  }
  if (!chaves.length) return jsonErr(400, `Nada para atualizar: envie pelo menos um campo (${CAMPOS.join(", ")}).`);

  const upd: Record<string, unknown> = {};
  const textos: Array<[Campo, number]> = [
    ["situacao", MAX_SITUACAO], ["risco", MAX_RISCO], ["observacao", MAX_OBS], ["proposta_obs", MAX_PROPOSTA_OBS],
  ];
  for (const [k, max] of textos) {
    if (k in b) {
      const r = lerTexto(b[k], ROTULO[k], max);
      if (!r.ok) return jsonErr(400, r.erro);
      upd[k] = r.v;
    }
  }
  for (const k of NUMERICOS) {
    if (k in b) {
      const r = lerValor(b[k], ROTULO[k]);
      if (!r.ok) return jsonErr(400, r.erro);
      upd[k] = r.v;
    }
  }
  if ("quitada" in b) {
    const r = lerBool(b.quitada, ROTULO.quitada);
    if (!r.ok) return jsonErr(400, r.erro);
    upd.quitada = r.v;
  }
  for (const k of DATAS) {
    if (k in b) {
      const r = lerData(b[k], ROTULO[k]);
      if (!r.ok) return jsonErr(400, r.erro);
      upd[k] = r.v;
    }
  }
  if ("comprometida_cortada" in b) {
    const r = lerBool(b.comprometida_cortada, ROTULO.comprometida_cortada);
    if (!r.ok) return jsonErr(400, r.erro);
    upd.comprometida_cortada = r.v;
  }
  if ("vobi_fornecedor_id" in b) {
    const v = b.vobi_fornecedor_id;
    if (v === null || v === "") upd.vobi_fornecedor_id = null;
    else {
      const nv = typeof v === "number" ? v : typeof v === "string" && /^[0-9]{1,10}$/.test(v.trim()) ? Number(v.trim()) : NaN;
      if (!Number.isInteger(nv) || nv <= 0 || nv > 2147483647) {
        return jsonErr(400, `O campo "${ROTULO.vobi_fornecedor_id}" precisa ser o número do cadastro na Vobi (inteiro maior que zero), ou null para desligar.`);
      }
      upd.vobi_fornecedor_id = nv;
    }
  }
  if ("cobranca" in b) {
    const c = b.cobranca;
    if (c === null || c === "") upd.cobranca = null;
    else if (typeof c === "string" && (COBRANCAS as readonly string[]).includes(c)) upd.cobranca = c;
    else {
      const op = COBRANCAS.map((x) => `${x} (${ROTULO_COBRANCA[x]})`).join(", ");
      return jsonErr(400, `Cobrança inválida. Use uma destas: ${op} — ou null para deduzir pela situação.`);
    }
  }

  const db = supabaseAdmin();
  const { data: antes, error: e1 } = await db.from(TABELA).select("*").eq("id", id).maybeSingle();
  if (e1) return erroDoBanco(e1);
  if (!antes) return jsonErr(404, "Dívida não encontrada. Ela pode ter sido removida; recarregue a página.");
  const A = antes as Record<string, unknown>;

  // marcou como quitada sem data: mantém a data que já existia (se já estava quitada) ou usa hoje
  let dataPadrao = false;
  if (upd.quitada === true && !upd.quitada_em) {
    upd.quitada_em = A.quitada === true && typeof A.quitada_em === "string" && A.quitada_em ? A.quitada_em : hojeSP();
    dataPadrao = !("quitada_em" in b) || b.quitada_em == null || b.quitada_em === "";
  }
  // cortou a despesa comprometida sem data: mantém a data que já existia (se já estava cortada) ou usa hoje
  let corteDataPadrao = false;
  if (upd.comprometida_cortada === true && !upd.cortada_em) {
    upd.cortada_em = A.comprometida_cortada === true && typeof A.cortada_em === "string" && A.cortada_em ? A.cortada_em : hojeSP();
    corteDataPadrao = !("cortada_em" in b) || b.cortada_em == null || b.cortada_em === "";
  }

  // piso x teto: só confere quando um dos dois foi enviado agora (não trava edição de outros campos)
  if ("valor" in upd || "valor_teto" in upd) {
    const piso = "valor" in upd ? upd.valor : A.valor;
    const teto = "valor_teto" in upd ? upd.valor_teto : A.valor_teto;
    if (piso != null && teto != null && Number(teto) < Number(piso)) {
      return jsonErr(400, `O valor máximo (teto, ${brl(teto)}) não pode ser menor que o valor (${brl(piso)}).`);
    }
  }

  // o que já venceu não é "a vencer": próximo vencimento no passado com a vencer > 0 é recusado
  if ("proximo_vencimento" in upd || "valor_a_vencer" in upd) {
    const pvF = "proximo_vencimento" in upd ? upd.proximo_vencimento : A.proximo_vencimento;
    const avF = "valor_a_vencer" in upd ? upd.valor_a_vencer : A.valor_a_vencer;
    const quitF = "quitada" in upd ? upd.quitada : A.quitada;
    const pv = pvF == null ? "" : String(pvF).slice(0, 10);
    if (quitF !== true && pv && pv < hojeSP() && Number(avF) > 0) {
      return jsonErr(400, `O próximo vencimento (${dataBR(pv)}) já passou: o que venceu nessa data é VENCIDO (vai no campo "vencido"). Informe a próxima data a vencer, ou deixe em branco.`);
    }
  }

  upd.updated_at = new Date().toISOString();
  upd.atualizado_por = admin.email || null;
  const { data, error } = await db.from(TABELA).update(upd).eq("id", id).select("*").maybeSingle();
  if (error) return erroDoBanco(error);
  if (!data) return jsonErr(404, "Dívida não encontrada. Ela pode ter sido removida; recarregue a página.");
  const D = data as Record<string, unknown>;

  // log: o que mudou, em português
  const enviadosBase = (dataPadrao && !chaves.includes("quitada_em") ? [...chaves, "quitada_em"] : chaves) as Campo[];
  const enviados = (corteDataPadrao && !enviadosBase.includes("cortada_em") ? [...enviadosBase, "cortada_em"] : enviadosBase) as Campo[];
  const ehNumero = (k: Campo) => (NUMERICOS as readonly string[]).includes(k);
  const ehData = (k: Campo) => (DATAS as readonly string[]).includes(k);
  // datas comparadas pelos 10 primeiros caracteres (o banco pode devolver "2026-10-14" ou com hora)
  const igual = (k: Campo) => (ehNumero(k)
    ? (A[k] == null ? null : Number(A[k])) === (D[k] == null ? null : Number(D[k]))
    : ehData(k) ? (A[k] == null ? null : String(A[k]).slice(0, 10)) === (D[k] == null ? null : String(D[k]).slice(0, 10))
    : (A[k] ?? null) === (D[k] ?? null));
  const partes = enviados.filter((k) => !igual(k)).map((k) => {
    if (k === "quitada") {
      return D.quitada === true
        ? `marcou como QUITADA (pago ${brl(D.valor_pago ?? D.valor_proposta ?? D.valor)} em ${dataBR(D.quitada_em)})`
        : "desmarcou a quitação (voltou para em aberto)";
    }
    if (k === "comprometida_cortada") {
      return D.comprometida_cortada === true
        ? `cortou a despesa comprometida — “não vai acontecer” (${brl(D.valor_a_vencer)} a vencer, em ${dataBR(D.cortada_em)})`
        : "desfez o corte da despesa comprometida (voltou a contar como comprometida)";
    }
    if (k === "cobranca") return `cobrança: ${rotuloCobranca(A[k])} → ${rotuloCobranca(D[k])}`;
    if (k === "vobi_fornecedor_id") {
      const nf = (v: unknown) => (v == null ? "não ligada" : `nº ${String(v)}`);
      return `fornecedor na Vobi: ${nf(A[k])} → ${nf(D[k])}`;
    }
    if (ehData(k)) return `${ROTULO[k]}: ${dataBR(A[k])} → ${dataBR(D[k])}`;
    if (ehNumero(k)) return `${ROTULO[k]}: ${brl(A[k])} → ${brl(D[k])}`;
    return `${ROTULO[k]} alterad${k === "risco" ? "o" : "a"}`;
  });
  const titulo = `${String(D.credor || "credor")}${D.identificacao ? ` (${String(D.identificacao)})` : ""}`.slice(0, 160);
  await registrarAcao(db, { req: request, admin }, {
    acao: "editar",
    entidade: TABELA,
    registro_id: id,
    descricao: `Situação Financeira — dívida ${titulo}: ${partes.length ? partes.join("; ") : "salvo sem mudanças"}`,
    dados: {
      antes: Object.fromEntries(enviados.map((k) => [k, A[k] ?? null])),
      depois: Object.fromEntries(enviados.map((k) => [k, D[k] ?? null])),
    },
  });

  return jsonOk(data);
};
