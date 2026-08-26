// Termo de Autorização de Venda, Divulgação de Imagens e Negociação de Valor.
//
// FONTE ÚNICA do texto: a tela pública mostra daqui e o servidor grava daqui.
// Se o texto vier de dois lugares, um dia a pessoa lê uma coisa e fica gravada
// outra — e aí o aceite não vale nada.
//
// Ao mudar o texto, MUDE A VERSÃO. Os aceites antigos guardam o texto integral
// que a pessoa leu, então nada quebra retroativamente.

export const TERMO_VERSAO = "2026-08-20.1";

/** Quem intermedia a venda (confirmado pela Adriana em 12/08/2026). */
export const INTERMEDIARIO = "CR INTERMEDIAÇÕES IMOBILIÁRIAS";

/** Corretor responsável / registro CRECI do INTERMEDIÁRIO.
 *  PENDENTE DE CONFIRMAÇÃO DA ADRIANA (20/08/2026): usamos o CRECI pessoa
 *  física do José (CRECISP 304329) como responsável técnico, por ser o único
 *  registro confirmado até aqui. Se a CR Intermediações tiver CRECI-J
 *  (pessoa jurídica) próprio, troque este valor antes de publicar — cobrar
 *  comissão de intermediação sem corretor/registro CRECI válido é exercício
 *  ilegal da profissão (Lei 6.530/1978). */
export const CRECI_RESPONSAVEL = "CRECISP 304329 (José Ferreira da Costa Júnior, corretor responsável)";

/** Comissão de intermediação (confirmada pela Adriana em 20/08/2026): 10%,
 *  composta por intermediação + serviços agregados de valorização do imóvel.
 *  O "3D" é sempre ideia conceitual/ilustrativa — nunca projeto técnico,
 *  para não se confundir com serviço de arquitetura/engenharia com ART/RRT. */
export const COMISSAO_PERCENTUAL = "10% (dez por cento)";
export const SERVICOS_AGREGADOS = [
  "vista aérea profissional do imóvel",
  "ideia conceitual em 3D, de caráter meramente ilustrativo, do potencial construtivo do terreno",
  "demais materiais e produtos de divulgação disponibilizados para aumentar a conversão da venda",
];

/** Prazo INDETERMINADO: a autorização vale até o proprietário pedir o
 *  cancelamento (decisão da Adriana em 12/08/2026 — antes eram 90 dias fixos).
 *  Por isso prazo_dias vai como null no banco; o aviso prévio continua valendo
 *  para o cancelamento produzir efeito. */
export const PRAZO_DIAS: number | null = null;
export const AVISO_DIAS = 5;

/** Contato do termo e da página. E-mail escolhido pela Adriana em 12/08/2026:
 *  adm@ e não o pessoal dela. */
export const CONTATO_EMAIL = "adm@costajr.com.br";
export const CONTATO_TELEFONE = "+55 11 91732-3082";

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
      titulo: "CLÁUSULA 3ª – DA COMISSÃO DE INTERMEDIAÇÃO E DOS SERVIÇOS AGREGADOS",
      texto: `Em caso de efetivação da venda do IMÓVEL, será devida ao(à) INTERMEDIÁRIO(A) [${CRECI_RESPONSAVEL}] comissão de ${COMISSAO_PERCENTUAL} sobre o valor da venda, composta por: (i) honorários pela intermediação e originação do negócio; e (ii) remuneração pelos serviços agregados de valorização do IMÓVEL disponibilizados pelo(a) INTERMEDIÁRIO(A) para aumentar a conversão da venda, a saber: ${SERVICOS_AGREGADOS.join("; ")}. A comissão só é devida se o negócio se concretizar — não há cobrança de cadastro, avaliação ou anúncio. Fica expressamente esclarecido que a ideia em 3D mencionada acima tem caráter meramente ilustrativo do potencial construtivo do terreno, não constituindo projeto técnico de arquitetura ou engenharia.`,
    },
    {
      titulo: "CLÁUSULA 4ª – DA AUTORIZAÇÃO PARA DIVULGAÇÃO DE IMAGENS",
      texto: `O(A) PROPRIETÁRIO(A) autoriza expressamente a captação e utilização de fotos, vídeos e demais imagens do IMÓVEL, interna e externamente, para fins exclusivos de divulgação e anúncio nos canais de venda do(a) INTERMEDIÁRIO(A) (site, redes sociais, portais imobiliários e materiais impressos), não sendo permitido uso para outra finalidade sem novo consentimento.`,
    },
    {
      titulo: "CLÁUSULA 5ª – DA NEGOCIAÇÃO COM POSSÍVEIS COMPRADORES",
      texto: `Fica o(a) INTERMEDIÁRIO(A) autorizado a realizar tratativas iniciais de valor com os possíveis compradores, incluindo apresentação de contrapropostas, ficando estabelecido que toda e qualquer negociação final de preço e condições de pagamento dependerá da aprovação expressa do(a) PROPRIETÁRIO(A) antes da formalização da venda.`,
    },
    {
      titulo: "CLÁUSULA 6ª – DO PRAZO E DA REVOGAÇÃO",
      texto: `O presente termo vigorará por prazo indeterminado, a contar da data do aceite, permanecendo válido até que o(a) PROPRIETÁRIO(A) solicite o seu cancelamento. A revogação poderá ser feita a qualquer tempo, por qualquer das partes, mediante comunicação por escrito, produzindo efeitos ${AVISO_DIAS} (cinco) dias após o recebimento da comunicação, prazo destinado à retirada dos anúncios e à conclusão das tratativas já em andamento.`,
    },
    {
      titulo: "CLÁUSULA 7ª – DISPOSIÇÕES GERAIS",
      texto: `O presente termo não implica transferência de posse, propriedade ou poderes de administração do IMÓVEL ao(à) INTERMEDIÁRIO(A), destinando-se exclusivamente à divulgação, captação de interessados e apoio às tratativas de venda descritas acima.`,
    },
    {
      titulo: "CLÁUSULA 8ª – DOS DADOS PESSOAIS (LGPD)",
      texto: `Os dados pessoais informados serão tratados exclusivamente para a finalidade de intermediação da venda do IMÓVEL, nos termos da Lei nº 13.709/2018. O(A) PROPRIETÁRIO(A) pode solicitar acesso, correção ou exclusão dos seus dados a qualquer momento pelo e-mail ${CONTATO_EMAIL} ou pelo telefone ${CONTATO_TELEFONE}.`,
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
