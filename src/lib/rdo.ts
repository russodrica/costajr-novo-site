// Diário de Obra (RDO) — constantes e helpers compartilhados.
// FONTE ÚNICA: a tela desenha daqui, a API valida daqui e a impressão traduz
// daqui. Assim não existe valor gravado que a tela não saiba mostrar.
import { supabaseAdmin2 } from "./supabase";

/** Bucket PRIVADO das fotos do diário. Fica no projeto costajr2 — o mesmo
 *  "depósito extra" do doc-empresa e de Novos Negócios, porque o Storage do
 *  projeto principal está no limite. Nada aqui é público: a tela pede a foto
 *  ao endpoint autenticado, que assina uma URL de 10 minutos. */
export const BUCKET_OBRAS = "obras";

export function storageObras() {
  return supabaseAdmin2();
}

/** Cria o bucket na primeira foto. Best-effort: "já existe" é ignorado. */
export async function garantirBucketObras(): Promise<void> {
  try {
    await storageObras().storage.createBucket(BUCKET_OBRAS, {
      public: false,
      fileSizeLimit: 26214400, // 25 MB
    });
  } catch { /* já existe (ou sem permissão) — o upload dirá se for problema real */ }
}

export const CLIMA = [
  { v: "sol", label: "Sol", icone: "☀️" },
  { v: "nublado", label: "Nublado", icone: "⛅" },
  { v: "chuva", label: "Chuva", icone: "🌧️" },
  { v: "impraticavel", label: "Impraticável", icone: "⛈️" },
] as const;

export const CONDICAO = [
  { v: "praticavel", label: "Praticável", badge: "badge-green" },
  { v: "parcial", label: "Parcialmente praticável", badge: "badge-yellow" },
  { v: "impraticavel", label: "Impraticável", badge: "badge-red" },
] as const;

export const SITUACAO_CHECK = [
  { v: "ok", label: "Conforme", badge: "badge-green" },
  { v: "nao", label: "Não conforme", badge: "badge-red" },
  { v: "na", label: "Não se aplica", badge: "badge-gray" },
  { v: "pendente", label: "Pendente", badge: "badge-yellow" },
] as const;

export const STATUS_RDO = [
  { v: "rascunho", label: "Rascunho", badge: "badge-yellow" },
  { v: "publicado", label: "Publicado", badge: "badge-green" },
] as const;

const rotulo = (lista: readonly { v: string; label: string }[], v: string | null | undefined) =>
  lista.find((i) => i.v === v)?.label || "—";

export const climaLabel = (v?: string | null) => rotulo(CLIMA, v);
export const climaIcone = (v?: string | null) => CLIMA.find((c) => c.v === v)?.icone || "";
export const condicaoLabel = (v?: string | null) => rotulo(CONDICAO, v);
export const situacaoLabel = (v?: string | null) => rotulo(SITUACAO_CHECK, v);
export const statusLabel = (v?: string | null) => rotulo(STATUS_RDO, v);
export const statusBadge = (v?: string | null) =>
  STATUS_RDO.find((s) => s.v === v)?.badge || "badge-gray";
export const condicaoBadge = (v?: string | null) =>
  CONDICAO.find((c) => c.v === v)?.badge || "badge-gray";
export const situacaoBadge = (v?: string | null) =>
  SITUACAO_CHECK.find((s) => s.v === v)?.badge || "badge-gray";

const umDe = (lista: readonly { v: string }[], v: unknown) =>
  lista.some((i) => i.v === String(v ?? "")) ? String(v) : null;

export const climaValido = (v: unknown) => umDe(CLIMA, v);
export const condicaoValida = (v: unknown) => umDe(CONDICAO, v);
export const statusValido = (v: unknown) => umDe(STATUS_RDO, v);
export const situacaoValida = (v: unknown) =>
  umDe(SITUACAO_CHECK, v) || "pendente";

/** Linha de efetivo/equipamento/ocorrência vinda do formulário.
 *  Só passa o que tem nome/tipo — linha em branco é descartada em vez de
 *  virar sujeira no relatório impresso. */
export function limparEfetivo(v: unknown): { funcao: string; qtd: number; empresa: string | null }[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((i: any) => ({
      funcao: String(i?.funcao ?? "").trim(),
      qtd: Math.max(0, Math.round(Number(i?.qtd) || 0)),
      empresa: String(i?.empresa ?? "").trim() || null,
    }))
    .filter((i) => i.funcao && i.qtd > 0)
    .slice(0, 60);
}

export function limparEquipamentos(v: unknown): { nome: string; qtd: number; horas: number | null }[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((i: any) => ({
      nome: String(i?.nome ?? "").trim(),
      qtd: Math.max(0, Math.round(Number(i?.qtd) || 0)) || 1,
      horas: Number.isFinite(Number(i?.horas)) && Number(i?.horas) > 0 ? Number(i.horas) : null,
    }))
    .filter((i) => i.nome)
    .slice(0, 60);
}

export function limparOcorrencias(v: unknown): { tipo: string; descricao: string; horas: number | null }[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((i: any) => ({
      tipo: String(i?.tipo ?? "").trim(),
      descricao: String(i?.descricao ?? "").trim(),
      horas: Number.isFinite(Number(i?.horas)) && Number(i?.horas) > 0 ? Number(i.horas) : null,
    }))
    .filter((i) => i.tipo || i.descricao)
    .slice(0, 60);
}

/** Total de gente em campo no dia (soma das quantidades por função). */
export function totalEfetivo(itens: unknown): number {
  if (!Array.isArray(itens)) return 0;
  return itens.reduce((s: number, i: any) => s + (Number(i?.qtd) || 0), 0);
}

export function fmtDataBr(d?: string | null): string {
  if (!d) return "—";
  return new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString("pt-BR");
}

export function fmtDataExtenso(d?: string | null): string {
  if (!d) return "—";
  return new Date(d.length === 10 ? `${d}T12:00:00` : d)
    .toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
}
