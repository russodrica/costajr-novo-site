// Utilitários das rotas de edição da Situação Financeira (/api/admin/situacao-financeira/*).
// Mesmas regras das rotas dividas/acoes/protestos (migration 118): corpo JSON (content-type obrigatório
// por causa do CSRF do Astro), limite de tamanho, textos aparados, valores em reais >= 0 com 2 casas,
// datas AAAA-MM-DD que existem no calendário, mensagens de erro em português.
// Fica em src/lib (e não em src/pages) para não virar rota.
import { jsonErr } from "./auth";
import { TIPOS_REAVER, ROTULO_TIPO_REAVER, CHANCES, ROTULO_CHANCE } from "./situacaoFinanceira";

export type Res<T> = { ok: true; v: T } | { ok: false; erro: string };

export const MAX_VALOR = 1_000_000_000_000; // R$ 1 trilhão: acima disso é erro de digitação

export function msgDe(e: unknown): string {
  return String((e as { message?: unknown } | null)?.message ?? e ?? "");
}

/** Falha do login/sessão → 401/403 com texto simples (o resto vira 500). */
export function erroDeAcesso(e: unknown): Response {
  const m = msgDe(e);
  const code = String((e as { code?: unknown } | null)?.code ?? "");
  if (m === "Sem permissão") return jsonErr(403, "Você não tem permissão para alterar esta área.");
  if (m === "Não autenticado" || m === "Token inválido" || code.startsWith("ERR_JW")) {
    return jsonErr(401, "Sua sessão expirou ou não é válida. Entre de novo no painel.");
  }
  return jsonErr(500, "Não consegui conferir o seu acesso agora. Tente de novo em instantes.", m);
}

export function erroDoBanco(err: { message?: string; code?: string } | null): Response {
  const m = err?.message || "";
  const code = err?.code || "";
  if (["42P01", "42703", "PGRST204", "PGRST205"].includes(code) || /does not exist|schema cache|Could not find the table/i.test(m)) {
    return jsonErr(503, "As tabelas da Situação Financeira ainda não estão completas no banco (migrations 118, 119 e 120). Peça para rodar as migrations e tente de novo.");
  }
  return jsonErr(500, "Não consegui salvar agora. Tente de novo em instantes.", m);
}

export function lerId(raw: string | undefined): string | null {
  const id = String(raw ?? "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(id) ? id : null;
}

export async function lerCorpo(
  request: Request, maxCorpo = 20000,
): Promise<{ ok: true; v: Record<string, unknown> } | { ok: false; status: number; erro: string }> {
  const ct = (request.headers.get("content-type") || "").toLowerCase();
  if (!ct.includes("application/json")) {
    return { ok: false, status: 415, erro: "Envie os dados em JSON (cabeçalho content-type: application/json)." };
  }
  let txt: string;
  try { txt = await request.text(); } catch { return { ok: false, status: 400, erro: "Não consegui ler os dados enviados." }; }
  if (txt.length > maxCorpo) return { ok: false, status: 413, erro: "Os dados enviados são grandes demais." };
  let b: unknown;
  try { b = JSON.parse(txt); } catch { return { ok: false, status: 400, erro: "Os dados enviados não são um JSON válido." }; }
  if (!b || typeof b !== "object" || Array.isArray(b)) {
    return { ok: false, status: 400, erro: "Os dados enviados precisam ser um objeto JSON, ex.: {\"titulo\": \"...\"}." };
  }
  return { ok: true, v: b as Record<string, unknown> };
}

/** Texto opcional: null/"" viram null; aparo nas pontas; limite de tamanho. */
export function lerTexto(v: unknown, rotulo: string, max: number): Res<string | null> {
  if (v === null || v === undefined) return { ok: true, v: null };
  if (typeof v !== "string") return { ok: false, erro: `O campo "${rotulo}" precisa ser um texto.` };
  const t = v.replace(/\u0000/g, "").trim();
  if (!t) return { ok: true, v: null };
  if (t.length > max) return { ok: false, erro: `O campo "${rotulo}" pode ter no máximo ${max} caracteres (veio com ${t.length}).` };
  return { ok: true, v: t };
}

/** Valor em reais >= 0, com 2 casas; null/"" apagam. Aceita número ou texto "1234.56", "1234,56", "1.234,56", "R$ 1.234,56". */
export function lerValor(v: unknown, rotulo: string): Res<number | null> {
  if (v === null || v === undefined || v === "") return { ok: true, v: null };
  let n: number;
  if (typeof v === "number") {
    n = v;
  } else if (typeof v === "string") {
    const s = v.trim().replace(/^R\$\s*/i, "");
    if (!s) return { ok: true, v: null };
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

/** Data AAAA-MM-DD (dia que existe no calendário) ou null/"" para apagar. */
export function lerData(v: unknown, rotulo: string): Res<string | null> {
  if (v === null || v === undefined || v === "") return { ok: true, v: null };
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

/** Sim/não: só true ou false (sem "1", "sim" etc., para não gravar por engano). */
export function lerBool(v: unknown, rotulo: string): Res<boolean> {
  if (v === true || v === false) return { ok: true, v };
  return { ok: false, erro: `O campo "${rotulo}" precisa ser true ou false.` };
}

/** Número inteiro (ordem na lista) ou null. */
export function lerInteiro(v: unknown, rotulo: string): Res<number | null> {
  if (v === null || v === undefined || v === "") return { ok: true, v: null };
  const n = typeof v === "number" ? v : (typeof v === "string" && /^-?\d+$/.test(v.trim()) ? Number(v.trim()) : NaN);
  if (!Number.isInteger(n) || Math.abs(n) > 1_000_000) return { ok: false, erro: `O campo "${rotulo}" precisa ser um número inteiro.` };
  return { ok: true, v: n };
}

/** Hoje no fuso de São Paulo (UTC−3), AAAA-MM-DD. */
export function hojeSP(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function dataBR(v: unknown): string {
  const s = typeof v === "string" ? v.slice(0, 10) : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "—";
}

export function brl(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return "R$ " + n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ───────────────────────── A reaver (fin_sf_reaver, migration 119) ─────────────────────────
export const CAMPOS_REAVER = [
  "tipo", "titulo", "contraparte", "valor_estimado", "chance", "situacao", "previsao", "fonte", "observacao",
  "recebido", "recebido_em", "valor_recebido", "ordem",
] as const;
export type CampoReaver = (typeof CAMPOS_REAVER)[number];
export const ROTULO_CAMPO_REAVER: Record<CampoReaver, string> = {
  tipo: "tipo", titulo: "título", contraparte: "contraparte", valor_estimado: "valor estimado", chance: "chance",
  situacao: "situação", previsao: "previsão", fonte: "fonte", observacao: "observação", recebido: "recebido",
  recebido_em: "data do recebimento", valor_recebido: "valor recebido", ordem: "ordem",
};
const MAX_REAVER: Partial<Record<CampoReaver, number>> = {
  titulo: 200, contraparte: 200, situacao: 1000, previsao: 200, fonte: 1000, observacao: 4000,
};

/** Lê e valida os campos de A REAVER presentes no corpo (só os enviados). `titulo: ""` vira null (a rota decide se pode). */
export function lerCamposReaver(b: Record<string, unknown>): Res<Partial<Record<CampoReaver, unknown>>> {
  const out: Partial<Record<CampoReaver, unknown>> = {};
  const R = ROTULO_CAMPO_REAVER;
  if ("tipo" in b) {
    const t = b.tipo;
    if (typeof t !== "string" || !(TIPOS_REAVER as readonly string[]).includes(t)) {
      const op = TIPOS_REAVER.map((x) => `${x} (${ROTULO_TIPO_REAVER[x]})`).join(", ");
      return { ok: false, erro: `Tipo inválido. Use um destes: ${op}.` };
    }
    out.tipo = t;
  }
  for (const k of ["titulo", "contraparte", "situacao", "previsao", "fonte", "observacao"] as const) {
    if (k in b) {
      const r = lerTexto(b[k], R[k], MAX_REAVER[k] || 1000);
      if (!r.ok) return r;
      out[k] = r.v;
    }
  }
  for (const k of ["valor_estimado", "valor_recebido"] as const) {
    if (k in b) {
      const r = lerValor(b[k], R[k]);
      if (!r.ok) return r;
      out[k] = r.v;
    }
  }
  if ("chance" in b) {
    const c = b.chance;
    if (c === null || c === "") out.chance = null;
    else if (typeof c === "string" && (CHANCES as readonly string[]).includes(c)) out.chance = c;
    else {
      const op = CHANCES.map((x) => `${x} (${ROTULO_CHANCE[x]})`).join(", ");
      return { ok: false, erro: `Chance inválida. Use uma destas: ${op}.` };
    }
  }
  if ("recebido" in b) {
    const r = lerBool(b.recebido, R.recebido);
    if (!r.ok) return r;
    out.recebido = r.v;
  }
  if ("recebido_em" in b) {
    const r = lerData(b.recebido_em, R.recebido_em);
    if (!r.ok) return r;
    out.recebido_em = r.v;
  }
  if ("ordem" in b) {
    const r = lerInteiro(b.ordem, R.ordem);
    if (!r.ok) return r;
    out.ordem = r.v;
  }
  return { ok: true, v: out };
}
