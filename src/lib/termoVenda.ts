// Termo de Autorização de Venda, Divulgação de Imagens e Negociação de Valor.
//
// FONTE ÚNICA do texto: a tela pública mostra daqui e o servidor grava daqui.
// Se o texto vier de dois lugares, um dia a pessoa lê uma coisa e fica gravada
// outra — e aí o aceite não vale nada.
//
// Ao mudar o texto, MUDE A VERSÃO. Os aceites antigos guardam o texto integral
// que a pessoa leu, então nada quebra retroativamente.

export const TERMO_VERSAO = "2026-08-12";

/** Quem intermedia a venda (confirmado pela Adriana em 12/08/2026). */
export const INTERMEDIARIO = "CR INTERMEDIAÇÕES IMOBILIÁRIAS";

/** Prazo e aviso prévio são FIXOS — padroniza e evita discussão depois. */
export const PRAZO_DIAS = 90;
export const AVISO_DIAS = 5;

export type DadosTermo = {
  nome?: string; nacionalidade?: string; estado_civil?: string; profissao?: string;
  rg?: string; cpf?: string;
  cep?: string; endereco?: string; numero?: string; complemento?: string;
  bairro?: string; cidade?: string; uf?: string;
  imovel_endereco?: string; imovel_numero?: string; imovel_bairro?: string;
  imovel_cidade?: string; imovel_uf?: string; imovel_cep?: string;
  imovel_matricula?: string; imovel_area?: string | number; imovel_descricao?: string;
  valor_referencia?: string | number;
};

const vazio = (v: any) => (v === null || v === undefined || String(v).trim() === "");
const ou = (v: any, alt = "não informado") => (vazio(v) ? alt : String(v).trim());

export function enderecoLinha(d: DadosTermo, prefixo: "" | "imovel_" = ""): string {
  const g = (k: string) => (d as any)[`${prefixo}${k}`];
  const rua = [g("endereco"), g("numero")].filter((x) => !vazio(x)).join(", ");
  const comp = prefixo === "" ? g("complemento") : "";
  return [rua, comp, g("bairro"), [g("cidade"), g("uf")].filter((x) => !vazio(x)).join("/"), g("cep")]
    .filter((x) => !vazio(x)).join(" - ");
}

export function moedaBr(v: any): string {
  const n = Number(String(v ?? "").replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return "a combinar";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** As cláusulas, para a tela mostrar em blocos legíveis. */
export function clausulas(d: DadosTermo): { titulo: string; texto: string }[] {
  return [
    {
      titulo: "CLÁUSULA 1ª – DO IMÓVEL",
      texto: `O presente termo tem por objeto o imóvel situado em ${ou(enderecoLinha(d, "imovel_"), "endereço a ser informado")}`
        + `${vazio(d.imovel_matricula) ? "" : `, matrícula nº ${String(d.imovel_matricula).trim()}`}`
        + `${vazio(d.imovel_area) ? "" : `, com área de ${String(d.imovel_area).trim()} m²`}`
        + `, de propriedade/posse do(a) PROPRIETÁRIO(A), doravante denominado simplesmente IMÓVEL.`,
    },
    {
      titulo: "CLÁUSULA 2ª – DA AUTORIZAÇÃO DE VENDA",
      texto: `O(A) PROPRIETÁRIO(A) autoriza o(a) INTERMEDIÁRIO(A) a anunciar e intermediar a venda do IMÓVEL junto a possíveis interessados, pelo valor de referência de ${moedaBr(d.valor_referencia)}, podendo o(a) INTERMEDIÁRIO(A) apresentar propostas ao(à) PROPRIETÁRIO(A) para análise e aceite final.`,
    },
    {
      titulo: "CLÁUSULA 3ª – DA AUTORIZAÇÃO PARA DIVULGAÇÃO DE IMAGENS",
      texto: `O(A) PROPRIETÁRIO(A) autoriza expressamente a captação e utilização de fotos, vídeos e demais imagens do IMÓVEL, interna e externamente, para fins exclusivos de divulgação e anúncio nos canais de venda do(a) INTERMEDIÁRIO(A) (site, redes sociais, portais imobiliários e materiais impressos), não sendo permitido uso para outra finalidade sem novo consentimento.`,
    },
    {
      titulo: "CLÁUSULA 4ª – DA NEGOCIAÇÃO COM POSSÍVEIS COMPRADORES",
      texto: `Fica o(a) INTERMEDIÁRIO(A) autorizado a realizar tratativas iniciais de valor com os possíveis compradores, incluindo apresentação de contrapropostas, ficando estabelecido que toda e qualquer negociação final de preço e condições de pagamento dependerá da aprovação expressa do(a) PROPRIETÁRIO(A) antes da formalização da venda.`,
    },
    {
      titulo: "CLÁUSULA 5ª – DO PRAZO E DA REVOGAÇÃO",
      texto: `O presente termo vigorará pelo prazo de ${PRAZO_DIAS} (noventa) dias a contar da data do aceite, podendo ser renovado por igual período mediante acordo entre as partes, ou revogado a qualquer tempo por qualquer das partes, mediante comunicação por escrito com antecedência mínima de ${AVISO_DIAS} (cinco) dias.`,
    },
    {
      titulo: "CLÁUSULA 6ª – DISPOSIÇÕES GERAIS",
      texto: `O presente termo não implica transferência de posse, propriedade ou poderes de administração do IMÓVEL ao(à) INTERMEDIÁRIO(A), destinando-se exclusivamente à divulgação, captação de interessados e apoio às tratativas de venda descritas acima.`,
    },
    {
      titulo: "CLÁUSULA 7ª – DOS DADOS PESSOAIS (LGPD)",
      texto: `Os dados pessoais informados serão tratados exclusivamente para a finalidade de intermediação da venda do IMÓVEL, nos termos da Lei nº 13.709/2018. O(A) PROPRIETÁRIO(A) pode solicitar acesso, correção ou exclusão dos seus dados a qualquer momento pelo e-mail adriana@costajr.com.br.`,
    },
  ];
}

/** Texto integral, do jeito que fica gravado como prova do aceite. */
export function montarTermo(d: DadosTermo, quando = new Date()): string {
  const data = quando.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const linhas: string[] = [
    "TERMO DE AUTORIZAÇÃO DE VENDA, DIVULGAÇÃO DE IMAGENS E NEGOCIAÇÃO DE VALOR",
    `(versão ${TERMO_VERSAO})`,
    "",
    "PROPRIETÁRIO(A):",
    `Nome completo: ${ou(d.nome)}`,
    `Nacionalidade: ${ou(d.nacionalidade)}   Estado civil: ${ou(d.estado_civil)}`,
    `Profissão: ${ou(d.profissao)}`,
    `RG nº: ${ou(d.rg)}   CPF nº: ${ou(d.cpf)}`,
    `Endereço completo (residencial): ${ou(enderecoLinha(d))}`,
    "",
    "(doravante denominado(a) simplesmente PROPRIETÁRIO(A));",
    `${INTERMEDIARIO}, doravante denominado(a) simplesmente INTERMEDIÁRIO(A);`,
    "",
    "As partes acima qualificadas firmam o presente Termo de Autorização, mediante as cláusulas e condições a seguir:",
    "",
  ];
  for (const c of clausulas(d)) { linhas.push(c.titulo, c.texto, ""); }
  linhas.push(
    "E por estarem de acordo, firmam o presente termo por meio eletrônico.",
    "",
    `Aceite eletrônico registrado em ${data} (horário de Brasília).`,
  );
  return linhas.join("\n");
}
