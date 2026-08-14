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

/** As duas áreas que fazem visita. Cada uma tem a SUA carteira de obras:
 *  Obras e Projetos usa a tabela `obras` (a que alimenta financeiro, ativos e
 *  tarefas); Fundação tem carteira própria em `obras_fundacao`, porque essa
 *  frente não aparece no cadastro de obras. */
export const AREAS = [
  {
    v: "obras",
    label: "Obras e Projetos",
    icone: "🏗️",
    tabela: "obras",
    empresaPadrao: "engenharia",
    ajuda: "Usa o cadastro de Obras & Projetos que já existe no portal.",
  },
  {
    v: "fundacao",
    label: "Fundação",
    icone: "🧱",
    tabela: "obras_fundacao",
    empresaPadrao: "consultoria",
    ajuda: "Carteira própria da área de fundação, cadastrada em Obras de Fundação.",
  },
] as const;

export type AreaRel = (typeof AREAS)[number];

export const areaDe = (v?: string | null): AreaRel =>
  AREAS.find((a) => a.v === v) || AREAS[0];

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

/** Cria o bucket na primeira foto.
 *  Devolve `null` quando está tudo certo (criado agora ou já existia) e a
 *  MENSAGEM do erro quando não dá para criar — quem chama decide o que mostrar.
 *  Engolir esse erro é o que faz o envio de foto falhar sem explicação. */
export async function garantirBucketObras(): Promise<string | null> {
  try {
    const { error } = await storageObras().storage.createBucket(BUCKET_OBRAS, {
      public: false,
      fileSizeLimit: 26214400, // 25 MB
    });
    if (!error) return null;
    const m = String(error.message || "").toLowerCase();
    return m.includes("already exists") || m.includes("duplicate") ? null : error.message;
  } catch (e: any) {
    return e?.message || "falha ao preparar o depósito de fotos";
  }
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
export const areaValida = (v: unknown) => umDe(AREAS, v) || "obras";

/** Status da obra — vale para as duas carteiras. */
export const STATUS_OBRA = [
  { v: "planejada", label: "Planejada", badge: "badge-blue" },
  { v: "ativa", label: "Ativa", badge: "badge-green" },
  { v: "pausada", label: "Pausada", badge: "badge-yellow" },
  { v: "concluida", label: "Concluída", badge: "badge-gray" },
  { v: "cancelada", label: "Cancelada", badge: "badge-red" },
] as const;

export const statusObraLabel = (v?: string | null) => rotulo(STATUS_OBRA, v);
export const statusObraBadge = (v?: string | null) =>
  STATUS_OBRA.find((s) => s.v === v)?.badge || "badge-gray";
export const statusObraValido = (v: unknown) => umDe(STATUS_OBRA, v) || "ativa";
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
