// FONTE ÚNICA dos tipos de documento do RH.
//
// Antes esta lista estava copiada em 8 arquivos (tela, upload, envio por e-mail,
// export de vencimentos, alertas...). Bastava alguém acrescentar um tipo em um
// lugar e o resto passava a mostrar a chave crua na tela. Agora todo mundo
// importa daqui.

export type TipoDocRh = { v: string; label: string; badge: string };

/** Ordem = ordem em que aparecem nas listas suspensas. */
export const TIPOS_DOC_RH: TipoDocRh[] = [
  { v: "contrato", label: "Contrato de trabalho", badge: "badge-blue" },
  { v: "aditivo", label: "Aditivo contratual", badge: "badge-blue" },
  { v: "admissional", label: "Documentos de admissão", badge: "badge-blue" },
  { v: "advertencia", label: "Advertência", badge: "badge-red" },
  { v: "suspensao", label: "Suspensão", badge: "badge-red" },
  { v: "atestado", label: "Atestado médico", badge: "badge-purple" },
  { v: "aso", label: "ASO / exame ocupacional", badge: "badge-green" },
  { v: "ficha_epi", label: "Ficha de EPI", badge: "badge-orange" },
  { v: "espelho_ponto", label: "Folha de ponto (espelho)", badge: "badge-yellow" },
  { v: "ferias", label: "Férias (aviso / recibo)", badge: "badge-green" },
  { v: "holerite", label: "Holerite / contracheque", badge: "badge-gray" },
  { v: "rescisao", label: "Rescisão / TRCT", badge: "badge-red" },
  { v: "vale_transporte", label: "Vale-transporte", badge: "badge-gray" },
  { v: "dados_bancarios", label: "Dados bancários", badge: "badge-gray" },
  { v: "certificado", label: "Certificado / treinamento", badge: "badge-blue" },
  { v: "cnh", label: "CNH", badge: "badge-gray" },
  { v: "declaracao", label: "Declaração", badge: "badge-gray" },
  { v: "outro", label: "Outro", badge: "badge-gray" },
];

export const TIPOS_DOC_VALORES: string[] = TIPOS_DOC_RH.map((t) => t.v);
export const TIPO_DOC_LABEL: Record<string, string> = Object.fromEntries(TIPOS_DOC_RH.map((t) => [t.v, t.label]));
export const TIPO_DOC_BADGE: Record<string, string> = Object.fromEntries(TIPOS_DOC_RH.map((t) => [t.v, t.badge]));

export function rotuloTipoDoc(v: string | null | undefined): string {
  const k = String(v || "outro");
  return TIPO_DOC_LABEL[k] || k;
}
export function badgeTipoDoc(v: string | null | undefined): string {
  return TIPO_DOC_BADGE[String(v || "outro")] || "badge-gray";
}

function norm(s: string): string {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// A ORDEM IMPORTA: o primeiro que casar vence. Por isso ASO vem antes de
// "atestado" (ASO é "atestado de saúde ocupacional" e cairia no lugar errado),
// e ficha de EPI vem antes de "certificado" (as fichas costumam citar NR-6).
const REGRAS: { tipo: string; re: RegExp }[] = [
  { tipo: "espelho_ponto", re: /espelho de ponto|folha de ponto|cartao( de)? ponto|apuracao (de |do )?ponto|controle de ponto|registro de ponto/ },
  { tipo: "aso", re: /\baso\b|atestado de saude ocupacional|exame (admissional|periodico|demissional|de retorno|de mudanca)|exame ocupacional/ },
  { tipo: "ficha_epi", re: /ficha de epi|ficha epi|entrega de epi|controle de epi|\bepis?\b/ },
  { tipo: "suspensao", re: /suspensao|suspensao disciplinar|termo de suspensao/ },
  { tipo: "advertencia", re: /advertencia|termo de adverten/ },
  { tipo: "rescisao", re: /rescisao|\btrct\b|termo de quitacao|homologacao|aviso previo/ },
  { tipo: "ferias", re: /\bferias\b|aviso de ferias|recibo de ferias/ },
  { tipo: "holerite", re: /holerite|contracheque|contra.?cheque|demonstrativo de pagamento|recibo de pagamento|folha de pagamento/ },
  { tipo: "vale_transporte", re: /vale.?transporte|\bvt\b|declaracao de transporte/ },
  { tipo: "dados_bancarios", re: /dados bancarios|conta salario|carta conta|dados para deposito/ },
  { tipo: "cnh", re: /\bcnh\b|carteira (nacional )?de habilitacao|habilitacao/ },
  { tipo: "atestado", re: /atestado|declaracao de comparecimento/ },
  { tipo: "certificado", re: /certificado|\bnr.?\s?\d+\b|treinamento|capacitacao|reciclagem/ },
  { tipo: "aditivo", re: /aditivo/ },
  { tipo: "contrato", re: /contrato/ },
  { tipo: "admissional", re: /ficha de registro|contrato de experiencia|admissao|admissional/ },
  { tipo: "declaracao", re: /declaracao/ },
];

/**
 * Descobre o tipo pelo título/nome do arquivo.
 *
 * Só age quando o documento está SEM tipo ou como "outro" — um tipo escolhido a
 * mão pela pessoa nunca é sobrescrito por palpite de texto. Devolve o próprio
 * tipo atual quando não reconhece nada.
 */
export function inferirTipoDoc(titulo: string, nomeArquivo = "", tipoAtual = ""): string {
  const atual = String(tipoAtual || "").trim();
  if (atual && atual !== "outro") return atual;
  const t = `${norm(titulo)} ${norm(nomeArquivo)}`;
  for (const r of REGRAS) if (r.re.test(t)) return r.tipo;
  return atual || "outro";
}
