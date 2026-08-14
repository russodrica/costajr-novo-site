// Relatório de Visita — constantes e helpers compartilhados.
// FONTE ÚNICA: a tela desenha daqui, a API valida daqui e a impressão traduz
// daqui. Assim não existe valor gravado que a tela não saiba mostrar.
//
// O relatório sempre nasce DENTRO de uma obra já cadastrada. A tabela continua
// se chamando `obras_rdo` (renomear tabela em produção não paga o risco), mas
// para quem usa o portal isso é o Relatório de Visita.
import { supabaseAdmin2 } from "./supabase";

/** Empresas que podem emitir o relatório. O grupo tem duas frentes e o
 *  cliente que recebe o PDF precisa ver a marca certa no cabeçalho. */
export const EMPRESAS = [
  {
    v: "engenharia",
    nome: "Costa Júnior Engenharia e Construções Ltda",
    curto: "Costa Júnior Engenharia",
    cnpj: "07.132.942/0001-72",
    logo: "/logo-cjr.png",
    cor: "#C41E3A",
  },
  {
    v: "consultoria",
    nome: "Costa Júnior Consultoria e Geotecnia",
    curto: "Costa Júnior Consultoria",
    cnpj: "",
    logo: "/logo-cjr-consultoria.png",
    cor: "#2A3E92",
  },
] as const;

export type EmpresaRel = (typeof EMPRESAS)[number];

export const empresaDe = (v?: string | null): EmpresaRel =>
  EMPRESAS.find((e) => e.v === v) || EMPRESAS[0];

/** Bucket PRIVADO das fotos do relatório. Fica no projeto costajr2 — o mesmo
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
export const empresaValida = (v: unknown) => umDe(EMPRESAS, v) || "engenharia";
export const situacaoValida = (v: unknown) =>
  umDe(SITUACAO_CHECK, v) || "pendente";

/** Linha de ocorrência vinda do formulário. Só passa o que tem tipo ou
 *  descrição — linha em branco é descartada em vez de virar sujeira no
 *  relatório impresso. */
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

export function fmtDataBr(d?: string | null): string {
  if (!d) return "—";
  return new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString("pt-BR");
}

export function fmtDataExtenso(d?: string | null): string {
  if (!d) return "—";
  return new Date(d.length === 10 ? `${d}T12:00:00` : d)
    .toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
}
