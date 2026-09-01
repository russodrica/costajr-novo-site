// Escopo de acesso do usuário EXTERNO (fornecedor / contador).
//
// Regra do produto: a liberação é escolhida NA CRIAÇÃO do login e vale a partir
// dali. Duas camadas, ambas conferidas no SERVIDOR:
//
//   1. MÓDULOS  — quais telas ele abre (Documentos da Empresa / Documentos
//      Bancários). Guardado em portal_perm_usuario, a MESMA tabela de override
//      dos usuários internos, então menu, middleware e guards já obedecem.
//      Sem linha gravada = sem acesso (deny-by-default no permissoes.ts).
//
//   2. BANCOS   — dentro de Documentos Bancários, quais bancos ele enxerga.
//      Guardado em portal_fornecedor_acesso (migration 115): "todos" ou uma
//      lista fechada. É a resposta para "ele vê todos os bancos ou só o Itaú?".
//
// Nada aqui ELEVA permissão: o teto do fornecedor continua sendo "ver" nos dois
// módulos (NIVEL_FORNECEDOR, em permissoes.ts). Isto só RESTRINGE.

import { normBanco } from "./sigilo";

export type BancosModo = "todos" | "lista";

export interface AcessoFornecedor {
  docEmpresa: boolean;
  docBancarios: boolean;
  bancosModo: BancosModo;
  /** Só vale quando bancosModo === "lista". */
  bancos: string[];
  /** Abas de dentro de Documentos Bancários (migration 116). Padrão: fechadas. */
  faturas: boolean;
  emprestimos: boolean;
}

/** Escopo mais fechado possível — usado quando nada foi gravado ou a leitura falha. */
export const ACESSO_VAZIO: AcessoFornecedor = { docEmpresa: false, docBancarios: false, bancosModo: "lista", bancos: [], faturas: false, emprestimos: false };

export const MODULOS_FORNECEDOR = [
  { key: "doc-empresa", label: "Documentos da Empresa", ajuda: "Certidões, cadastrais, contábeis, fiscais. Contratos, clientes, consórcios e seguros ficam fora sempre." },
  { key: "doc-bancarios", label: "Documentos Bancários", ajuda: "Extratos bancários. Faturas de cartão e empréstimos são abas à parte, liberadas só se você marcar." },
] as const;

/**
 * Lê o escopo de UM fornecedor. Nunca lança: em qualquer erro devolve o escopo
 * vazio (falha fechando, não abrindo).
 */
export async function acessoFornecedor(db: any, profileId: string): Promise<AcessoFornecedor> {
  const out: AcessoFornecedor = { ...ACESSO_VAZIO, bancos: [] };
  const pid = String(profileId || "");
  if (!pid) return out;
  try {
    const { data: perms } = await db.from("portal_perm_usuario").select("modulo, nivel").eq("profile_id", pid);
    for (const r of (perms || []) as any[]) {
      const liberado = r.nivel === "ver" || r.nivel === "editar"; // fornecedor é capado em "ver" adiante
      if (r.modulo === "doc-empresa") out.docEmpresa = liberado;
      if (r.modulo === "doc-bancarios") out.docBancarios = liberado;
    }
  } catch { /* tabela ausente → escopo vazio */ }
  try {
    const { data: row } = await db.from("portal_fornecedor_acesso").select("*").eq("profile_id", pid).maybeSingle();
    if (row) {
      out.bancosModo = (row as any).bancos_modo === "lista" ? "lista" : "todos";
      out.bancos = (((row as any).bancos || []) as any[]).map((b) => String(b)).filter(Boolean);
      // colunas da 116 — se a migration ainda não rodou, o campo vem undefined e
      // o padrão fechado prevalece (falha fechando).
      out.faturas = (row as any).faturas === true;
      out.emprestimos = (row as any).emprestimos === true;
    } else {
      // Sem linha de escopo: não inventa liberação. Se o módulo bancário estiver
      // ligado mas ninguém escolheu bancos, ele não vê banco nenhum até alguém
      // escolher — é a falha na direção segura.
      out.bancosModo = "lista";
      out.bancos = [];
    }
  } catch {
    out.bancosModo = "lista";
    out.bancos = [];
  }
  return out;
}

/** Este banco/cartão está no escopo do fornecedor? (comparação sem acento/caixa) */
export function bancoLiberado(acesso: AcessoFornecedor, banco: string | null | undefined): boolean {
  if (!acesso.docBancarios) return false;
  if (acesso.bancosModo === "todos") return true;
  const n = normBanco(banco || "");
  if (!n) return false; // extrato sem banco preenchido não vaza numa lista fechada
  return acesso.bancos.some((b) => normBanco(b) === n);
}

/** Grava o escopo de bancos (a parte de módulos vai por portal_perm_usuario). */
export async function salvarBancosFornecedor(
  db: any,
  profileId: string,
  modo: BancosModo,
  bancos: string[],
  porQuem?: string | null,
  abas?: { faturas?: boolean; emprestimos?: boolean },
): Promise<void> {
  await db.from("portal_fornecedor_acesso").upsert({
    profile_id: String(profileId),
    bancos_modo: modo === "lista" ? "lista" : "todos",
    bancos: modo === "lista" ? bancos.map((b) => String(b).slice(0, 120)) : [],
    faturas: !!abas?.faturas,
    emprestimos: !!abas?.emprestimos,
    atualizado_em: new Date().toISOString(),
    atualizado_por: porQuem || null,
  }, { onConflict: "profile_id" });
}

/** Grava os módulos liberados na tabela de overrides (nível sempre "ver"). */
export async function salvarModulosFornecedor(
  db: any,
  profileId: string,
  modulos: { docEmpresa: boolean; docBancarios: boolean },
): Promise<void> {
  const pid = String(profileId);
  const linhas = [
    { profile_id: pid, modulo: "doc-empresa", nivel: modulos.docEmpresa ? "ver" : "nenhum" },
    { profile_id: pid, modulo: "doc-bancarios", nivel: modulos.docBancarios ? "ver" : "nenhum" },
  ].map((l) => ({ ...l, updated_at: new Date().toISOString() }));
  await db.from("portal_perm_usuario").upsert(linhas, { onConflict: "profile_id,modulo" });
}

/** Resumo em uma linha, para telas e auditoria. */
export function resumoAcesso(a: AcessoFornecedor): string {
  const mods: string[] = [];
  if (a.docEmpresa) mods.push("Documentos da Empresa");
  if (a.docBancarios) {
    const extras = [a.faturas ? "faturas" : null, a.emprestimos ? "empréstimos" : null].filter(Boolean).join(" + ");
    mods.push((a.bancosModo === "todos"
      ? "Documentos Bancários (todos os bancos"
      : `Documentos Bancários (${a.bancos.length ? a.bancos.join(", ") : "nenhum banco escolhido"}`) + (extras ? `; ${extras}` : "") + ")");
  }
  return mods.length ? mods.join(" + ") : "nenhum acesso liberado";
}
