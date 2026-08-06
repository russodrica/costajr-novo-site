// Novos Negócios — constantes e helpers compartilhados pelas 4 telas e pelas APIs.
// FONTE ÚNICA dos rótulos/status: a tela e o endpoint validam com a MESMA lista,
// então não dá para gravar um status que a tela não sabe desenhar.
import { supabaseAdmin2 } from "./supabase";

/** Bucket PRIVADO dos arquivos de Novos Negócios (fotos do catálogo + documentos).
 *  Fica no projeto costajr2 — o mesmo "depósito extra" já usado pelo doc-empresa,
 *  porque o Storage do projeto principal está no limite. Nada aqui é público: a
 *  tela pede o arquivo pelo endpoint autenticado, que assina uma URL de 10 min. */
export const BUCKET_NEGOCIOS = "negocios";

/** Cliente de storage do módulo (banco continua no projeto principal). */
export function storageNegocios() {
  return supabaseAdmin2();
}

/** Cria o bucket na primeira vez que alguém sobe um arquivo. Best-effort:
 *  se já existe, o erro "already exists" é ignorado de propósito. */
export async function garantirBucketNegocios(): Promise<void> {
  try {
    await storageNegocios().storage.createBucket(BUCKET_NEGOCIOS, {
      public: false,
      fileSizeLimit: 26214400, // 25 MB
    });
  } catch { /* já existe (ou sem permissão) — o upload dirá se for problema real */ }
}

export const TIPOS = ["terreno", "empreendimento", "busca"] as const;
export type TipoNegocio = (typeof TIPOS)[number];

export const TIPO_LABEL: Record<string, string> = {
  terreno: "Terreno",
  empreendimento: "Empreendimento",
  busca: "Busca de imóvel",
};
/** Rótulo da TELA (plural) e texto de apoio de cada aba. */
export const TIPO_TELA: Record<string, { titulo: string; singular: string; ajuda: string }> = {
  terreno: {
    titulo: "Venda de Terrenos",
    singular: "terreno",
    ajuda: "Terrenos à venda. Cada card guarda a foto do catálogo, os dados completos, os documentos (matrícula, IPTU, certidões) e os interessados.",
  },
  empreendimento: {
    titulo: "Venda de Empreendimentos",
    singular: "empreendimento",
    ajuda: "Empreendimentos à venda. Além dos dados do imóvel, guarde a incorporadora, a previsão de entrega e quantas unidades ainda estão disponíveis.",
  },
  busca: {
    titulo: "Busca de Imóveis",
    singular: "pedido de busca",
    ajuda: "Clientes procurando imóvel. Registre o perfil desejado e a faixa de valor; os interessados aqui são as opções apresentadas ao cliente.",
  },
};

/** Status do próprio item. A lista muda conforme o tipo. */
export const STATUS_ITEM: Record<string, { v: string; label: string; badge: string }[]> = {
  terreno: [
    { v: "disponivel", label: "Disponível", badge: "badge-green" },
    { v: "reservado", label: "Reservado", badge: "badge-yellow" },
    { v: "vendido", label: "Vendido", badge: "badge-blue" },
    { v: "pausado", label: "Pausado", badge: "badge-gray" },
  ],
  empreendimento: [
    { v: "disponivel", label: "Disponível", badge: "badge-green" },
    { v: "reservado", label: "Reservado", badge: "badge-yellow" },
    { v: "vendido", label: "Vendido", badge: "badge-blue" },
    { v: "pausado", label: "Pausado", badge: "badge-gray" },
  ],
  busca: [
    { v: "procurando", label: "Procurando", badge: "badge-yellow" },
    { v: "encontrado", label: "Encontrado", badge: "badge-green" },
    { v: "encerrado", label: "Encerrado", badge: "badge-gray" },
  ],
};
export function statusValidos(tipo: string): string[] {
  return (STATUS_ITEM[tipo] || STATUS_ITEM.terreno).map((s) => s.v);
}
export function statusLabel(tipo: string, v: string): string {
  return (STATUS_ITEM[tipo] || STATUS_ITEM.terreno).find((s) => s.v === v)?.label || v;
}
export function statusBadge(tipo: string, v: string): string {
  return (STATUS_ITEM[tipo] || STATUS_ITEM.terreno).find((s) => s.v === v)?.badge || "badge-gray";
}

/** Funil dos interessados — igual nos três tipos (foi o que a Adriana pediu). */
export const FUNIL = [
  { v: "contatado", label: "Contatado", badge: "badge-blue", cor: "#2563EB" },
  { v: "em_negociacao", label: "Em negociação", badge: "badge-yellow", cor: "#D97706" },
  { v: "fechado", label: "Fechado", badge: "badge-green", cor: "#16A34A" },
  { v: "perdido", label: "Perdido", badge: "badge-red", cor: "#DC2626" },
] as const;
export const FUNIL_VALORES = FUNIL.map((f) => f.v);
/** Etapas que contam como "em andamento" (o negócio ainda está vivo). */
export const FUNIL_ABERTO = ["contatado", "em_negociacao"];
export function funilLabel(v: string): string {
  return FUNIL.find((f) => f.v === v)?.label || v;
}
export function funilBadge(v: string): string {
  return FUNIL.find((f) => f.v === v)?.badge || "badge-gray";
}

export const TIPOS_ANEXO = [
  { v: "matricula", label: "Matrícula" },
  { v: "iptu", label: "IPTU / carnê" },
  { v: "certidao", label: "Certidão" },
  { v: "planta", label: "Planta / projeto" },
  { v: "contrato", label: "Contrato / proposta" },
  { v: "memorial", label: "Memorial descritivo" },
  { v: "outro", label: "Outro" },
];
export const TIPOS_ANEXO_VALORES = TIPOS_ANEXO.map((t) => t.v);

/** Campos que a API aceita gravar. Qualquer coisa fora disso é ignorada —
 *  evita que um campo novo do formulário grave lixo sem passar por aqui. */
export const CAMPOS_IMOVEL = [
  "codigo", "titulo", "descricao", "status",
  "endereco", "numero", "bairro", "cidade", "uf", "cep", "referencia",
  "area_total", "area_construida", "quartos", "suites", "banheiros", "vagas",
  "valor", "valor_minimo", "comissao_percent",
  "matricula", "inscricao_municipal", "zoneamento", "topografia",
  "incorporadora", "previsao_entrega", "unidades_total", "unidades_disponiveis",
  "cliente_nome", "cliente_contato", "perfil_procurado", "faixa_valor_min", "faixa_valor_max",
  "proprietario_nome", "proprietario_contato", "origem",
  "responsavel", "observacoes", "ativo",
] as const;

const NUMERICOS = new Set([
  "area_total", "area_construida", "quartos", "suites", "banheiros", "vagas",
  "valor", "valor_minimo", "comissao_percent", "unidades_total", "unidades_disponiveis",
  "faixa_valor_min", "faixa_valor_max",
]);
const DATAS = new Set(["previsao_entrega"]);

/** Normaliza o corpo do formulário: string vazia vira null, número vira número.
 *  Sem isso o Postgres recusa `""` em coluna numeric/date. */
export function limparCamposImovel(body: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const k of CAMPOS_IMOVEL) {
    if (!(k in body)) continue;
    let v: any = body[k];
    if (typeof v === "string") v = v.trim();
    if (v === "" || v === undefined) { out[k] = null; continue; }
    if (NUMERICOS.has(k)) {
      const n = Number(String(v).replace(/\./g, "").replace(",", "."));
      out[k] = Number.isFinite(n) ? n : null;
      continue;
    }
    if (DATAS.has(k)) { out[k] = v || null; continue; }
    if (k === "ativo") { out[k] = v === true || v === "true" || v === "on"; continue; }
    if (k === "uf" && typeof v === "string") { out[k] = v.toUpperCase().slice(0, 2); continue; }
    out[k] = v;
  }
  return out;
}

export const CAMPOS_OPORTUNIDADE = [
  "nome", "email", "telefone", "origem", "valor_proposto", "status",
  "motivo_perda", "ultimo_contato", "proximo_contato", "responsavel", "observacoes",
] as const;

export function limparCamposOportunidade(body: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const k of CAMPOS_OPORTUNIDADE) {
    if (!(k in body)) continue;
    let v: any = body[k];
    if (typeof v === "string") v = v.trim();
    if (v === "" || v === undefined) { out[k] = null; continue; }
    if (k === "valor_proposto") {
      const n = Number(String(v).replace(/\./g, "").replace(",", "."));
      out[k] = Number.isFinite(n) ? n : null;
      continue;
    }
    out[k] = v;
  }
  return out;
}

export function fmtMoeda(v: number | null | undefined): string {
  if (v == null || v === ("" as any)) return "—";
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}
export function fmtData(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d + (d.length === 10 ? "T12:00:00" : "")).toLocaleDateString("pt-BR");
}
/** Dias desde a última movimentação (para o "parados / sem contato" do Resumo). */
export function diasDesde(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}
