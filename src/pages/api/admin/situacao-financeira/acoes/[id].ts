import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr, type AdminClaims } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";
import { bloqueioSeSoLeitura } from "../../../../../lib/permissoes";
import { STATUS_ACAO, ROTULO_STATUS, type StatusAcao } from "../../../../../lib/situacaoFinanceira";
import { lerValor, brl } from "../../../../../lib/situacaoFinanceiraApi";

export const prerender = false;

// PATCH /api/admin/situacao-financeira/acoes/<id>
// Atualiza o acompanhamento de UMA ideia do plano de ação (tabela fin_sf_acoes, migration 118).
// Corpo (JSON, todos opcionais, pelo menos 1): { status, responsavel, prazo (AAAA-MM-DD | null), notas, valor_vendido }
//   valor_vendido (migration 119): quanto já faturou com a ideia, em reais >= 0 (aceita "1.234,56"), ou null.
// Os textos do plano (título, descrição, onda...) vêm do seed e NÃO são editáveis por aqui.
const MODULO = "situacao-financeira";
const TABELA = "fin_sf_acoes";
const CAMPOS = ["status", "responsavel", "prazo", "notas", "valor_vendido"] as const;
type Campo = (typeof CAMPOS)[number];
const ROTULO: Record<Campo, string> = { status: "situação", responsavel: "responsável", prazo: "prazo", notas: "anotações", valor_vendido: "valor vendido" };
const MAX_RESPONSAVEL = 80;
const MAX_NOTAS = 4000;
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
    return jsonErr(503, "As tabelas da Situação Financeira ainda não estão completas no banco (migrations 118 e 119). Peça para rodar as migrations e tente de novo.");
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
    return { ok: false, status: 400, erro: "Os dados enviados precisam ser um objeto JSON, ex.: {\"status\": \"testando\"}." };
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

/** Data AAAA-MM-DD (dia que existe no calendário) ou null/"" para apagar. */
function lerData(v: unknown, rotulo: string): Res<string | null> {
  if (v === null || v === "") return { ok: true, v: null };
  if (typeof v !== "string") return { ok: false, erro: `A data em "${rotulo}" precisa vir como texto AAAA-MM-DD (ex.: 2026-10-31).` };
  const s = v.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return { ok: false, erro: `Data inválida em "${rotulo}": use o formato AAAA-MM-DD (ex.: 2026-10-31).` };
  const a = Number(m[1]), mes = Number(m[2]), d = Number(m[3]);
  const dt = new Date(Date.UTC(a, mes - 1, d));
  if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== mes - 1 || dt.getUTCDate() !== d) {
    return { ok: false, erro: `A data em "${rotulo}" não existe no calendário (${s}).` };
  }
  if (a < 1990 || a > 2100) return { ok: false, erro: `A data em "${rotulo}" está fora do intervalo aceito (1990 a 2100).` };
  return { ok: true, v: s };
}

function dataBR(v: unknown): string {
  const s = typeof v === "string" ? v.slice(0, 10) : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "—";
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
  if (!id) return jsonErr(400, "Identificador da ação inválido.");

  const corpo = await lerCorpo(request);
  if (!corpo.ok) return jsonErr(corpo.status, corpo.erro);
  const b = corpo.v;

  const chaves = Object.keys(b);
  const extras = chaves.filter((k) => !(CAMPOS as readonly string[]).includes(k));
  if (extras.length) {
    return jsonErr(400, `Campo não aceito: ${extras.join(", ")}. Nesta tela só dá para alterar: ${CAMPOS.join(", ")}.`);
  }
  if (!chaves.length) return jsonErr(400, "Nada para atualizar: envie pelo menos um campo (status, responsavel, prazo, notas ou valor_vendido).");

  const upd: Record<string, unknown> = {};
  if ("status" in b) {
    const s = b.status;
    if (typeof s !== "string" || !STATUS_ACAO.includes(s as StatusAcao)) {
      const opcoes = STATUS_ACAO.map((x) => `${x} (${ROTULO_STATUS[x]})`).join(", ");
      return jsonErr(400, `Situação inválida. Use uma destas: ${opcoes}.`);
    }
    upd.status = s;
  }
  if ("responsavel" in b) {
    const r = lerTexto(b.responsavel, ROTULO.responsavel, MAX_RESPONSAVEL);
    if (!r.ok) return jsonErr(400, r.erro);
    upd.responsavel = r.v;
  }
  if ("prazo" in b) {
    const r = lerData(b.prazo, ROTULO.prazo);
    if (!r.ok) return jsonErr(400, r.erro);
    upd.prazo = r.v;
  }
  if ("notas" in b) {
    const r = lerTexto(b.notas, ROTULO.notas, MAX_NOTAS);
    if (!r.ok) return jsonErr(400, r.erro);
    upd.notas = r.v;
  }
  if ("valor_vendido" in b) {
    const r = lerValor(b.valor_vendido, ROTULO.valor_vendido);
    if (!r.ok) return jsonErr(400, r.erro);
    upd.valor_vendido = r.v;
  }

  const db = supabaseAdmin();
  const { data: antes, error: e1 } = await db.from(TABELA).select("*").eq("id", id).maybeSingle();
  if (e1) return erroDoBanco(e1);
  if (!antes) return jsonErr(404, "Ação não encontrada. Ela pode ter sido removida; recarregue a página.");

  upd.updated_at = new Date().toISOString();
  upd.atualizado_por = admin.email || null;
  const { data, error } = await db.from(TABELA).update(upd).eq("id", id).select("*").maybeSingle();
  if (error) return erroDoBanco(error);
  if (!data) return jsonErr(404, "Ação não encontrada. Ela pode ter sido removida; recarregue a página.");

  // log: o que mudou, em português
  const enviados = chaves as Campo[];
  const mudou = enviados.filter((k) => {
    const a = (antes as Record<string, unknown>)[k], d = (data as Record<string, unknown>)[k];
    if (k === "valor_vendido") return (a == null ? null : Number(a)) !== (d == null ? null : Number(d));
    return a !== d;
  });
  const partes = mudou.map((k) => {
    const a = (antes as Record<string, unknown>)[k];
    const d = (data as Record<string, unknown>)[k];
    if (k === "status") {
      const ra = ROTULO_STATUS[a as StatusAcao] ?? String(a ?? "—");
      const rd = ROTULO_STATUS[d as StatusAcao] ?? String(d ?? "—");
      return `situação: ${ra} → ${rd}`;
    }
    if (k === "responsavel") return `responsável: ${a || "—"} → ${d || "—"}`;
    if (k === "prazo") return `prazo: ${dataBR(a)} → ${dataBR(d)}`;
    if (k === "valor_vendido") return `vendido: ${brl(a)} → ${brl(d)}`;
    return "anotações alteradas";
  });
  const titulo = String((data as Record<string, unknown>).titulo || id).slice(0, 120);
  await registrarAcao(db, { req: request, admin }, {
    acao: "editar",
    entidade: TABELA,
    registro_id: id,
    descricao: `Situação Financeira — plano de ação "${titulo}": ${partes.length ? partes.join("; ") : "salvo sem mudanças"}`,
    dados: {
      antes: Object.fromEntries(enviados.map((k) => [k, (antes as Record<string, unknown>)[k] ?? null])),
      depois: Object.fromEntries(enviados.map((k) => [k, (data as Record<string, unknown>)[k] ?? null])),
    },
  });

  return jsonOk(data);
};
