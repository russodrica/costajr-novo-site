// Investidores — FONTE ÚNICA das listas de opções.
// O formulário público desenha a partir daqui, o endpoint valida com a MESMA
// lista e a tela do admin traduz os códigos para rótulo. Assim não existe
// valor gravado que a tela não saiba mostrar.

export const OPERACOES = [
  { v: "compra_venda", label: "Compra e revenda" },
  { v: "incorporacao", label: "Incorporação / construir para vender" },
  { v: "loteamento", label: "Loteamento" },
  { v: "renda", label: "Renda (alugar)" },
  { v: "permuta", label: "Permuta" },
] as const;

export const TIPOS_IMOVEL = [
  { v: "terreno", label: "Terreno urbano" },
  { v: "area", label: "Área / gleba" },
  { v: "galpao", label: "Galpão / logística" },
  { v: "comercial", label: "Comercial / lajes" },
  { v: "residencial", label: "Residencial" },
  { v: "rural", label: "Rural" },
] as const;

export const PRAZOS = [
  { v: "imediato", label: "Imediato — tenho recurso disponível agora" },
  { v: "6_meses", label: "Até 6 meses" },
  { v: "12_meses", label: "Até 12 meses" },
  { v: "sem_pressa", label: "Sem prazo definido" },
] as const;

export const RECURSOS = [
  { v: "proprio", label: "Recurso próprio" },
  { v: "financiamento", label: "Financiamento" },
  { v: "misto", label: "Próprio + financiamento" },
] as const;

export const EXPERIENCIAS = [
  { v: "primeira", label: "Seria meu primeiro investimento em imóvel" },
  { v: "alguma", label: "Já fiz alguns negócios" },
  { v: "recorrente", label: "Invisto com frequência" },
] as const;

export const STATUS_INVESTIDOR = [
  { v: "novo", label: "Novo", badge: "badge-yellow" },
  { v: "qualificado", label: "Qualificado", badge: "badge-blue" },
  { v: "ativo", label: "Ativo", badge: "badge-green" },
  { v: "arquivado", label: "Arquivado", badge: "badge-gray" },
] as const;

const mapa = (lista: readonly { v: string; label: string }[]) =>
  Object.fromEntries(lista.map((i) => [i.v, i.label]));

export const LABEL_OPERACAO = mapa(OPERACOES);
export const LABEL_TIPO = mapa(TIPOS_IMOVEL);
export const LABEL_PRAZO = mapa(PRAZOS);
export const LABEL_RECURSO = mapa(RECURSOS);
export const LABEL_EXPERIENCIA = mapa(EXPERIENCIAS);

/** Mantém só os códigos que existem na lista — o resto é descartado em vez de
 *  virar lixo no banco. Aceita array ou string única vinda do formulário. */
export function filtrarCodigos(valor: unknown, lista: readonly { v: string }[]): string[] {
  const validos = new Set(lista.map((i) => i.v));
  const bruto = Array.isArray(valor) ? valor : valor == null ? [] : [valor];
  return bruto.map((v) => String(v)).filter((v) => validos.has(v));
}

export function umDe(valor: unknown, lista: readonly { v: string }[]): string | null {
  const v = String(valor ?? "");
  return lista.some((i) => i.v === v) ? v : null;
}

/** "1.500.000" / "1500000,50" → 1500000 */
export function numeroBr(v: unknown): number | null {
  const s = String(v ?? "").replace(/\./g, "").replace(",", ".").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function faixaTexto(min: number | null, max: number | null): string {
  const f = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  if (min && max) return `${f(min)} a ${f(max)}`;
  if (min) return `a partir de ${f(min)}`;
  if (max) return `até ${f(max)}`;
  return "a combinar";
}
