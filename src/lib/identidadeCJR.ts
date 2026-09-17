// Quem é cada lado de um comprovante: a própria Costa Júnior, ou um terceiro?
//
// É a pergunta que decide TUDO no bot financeiro. A CJR pagando um terceiro é
// uma DESPESA a baixar; um terceiro pagando a CJR é uma RECEITA a baixar; a CJR
// dos dois lados é uma transferência entre contas próprias, que não tem
// lançamento nenhum e precisa ser criada. Errar aqui não dá erro na tela: dá
// lançamento errado no livro.
//
// Mora num módulo sem nenhuma dependência de propósito — dá para testar sem
// Vobi, sem IA e sem banco.

/** CNPJs da empresa. A raiz 07132942 é a Engenharia. Filiais e a Consultoria
 *  entram aqui quando a Adriana passar os números. */
const CNPJS_CJR = ["07132942000172"];
/** A raiz (8 primeiros dígitos) já identifica o grupo, filial inclusive. */
const RAIZES_CJR = CNPJS_CJR.map((c) => c.slice(0, 8));

/** Palavras que só aparecem em nome de pessoa JURÍDICA. */
const PALAVRA_EMPRESA = /ENGENHARIA|CONSTRU|LTDA|EIRELI|CONSULTORIA|GEOTECNIA|EMPREEND/;
/** O nome da empresa depois de normalizado (sem espaço nem pontuação). */
const NOME_CJR = /COSTAJUNIOR|COSTAJR|COSTAJUN/;
/**
 * Sobrenome de pessoa física: "JOSE FERREIRA DA COSTA JUNIOR" é o SÓCIO, não a
 * empresa — e ele recebe pagamentos dela (há "HONORÁRIO DIRETORIA" em aberto, e
 * ele está no cadastro de clientes com o id 235730). Confundir os dois faria um
 * pagamento ao sócio virar transferência entre contas.
 */
const SOBRENOME_PESSOA = /D[AEO]S?COSTAJUNIOR/;

export type LadoCJR = "cjr" | "terceiro" | "desconhecido";

export type Identificacao = {
  lado: LadoCJR;
  /** o que decidiu — útil para explicar na tela e para depurar */
  forca: "cnpj" | "mascara" | "nome" | "nenhuma";
  motivo: string;
};

/** MAIÚSCULA, sem acento e sem nada que não seja letra ou dígito. */
function norm(s: unknown): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** Só os dígitos. */
const digitos = (s: unknown) => String(s ?? "").replace(/\D/g, "");

/**
 * O documento mascarado do comprovante bate com um CNPJ nosso?
 *
 * Os bancos imprimem "07.******\/****-72" — e isso, sozinho, NÃO prova nada: são
 * só 4 dígitos visíveis, e qualquer CNPJ começado em 07 e terminado em 72
 * casaria. Exigimos 6 dígitos visíveis para tratar a máscara como prova.
 */
function casaMascara(doc: string, cnpj: string): boolean {
  const m = String(doc ?? "").replace(/[^\d*]/g, "");
  if (m.length !== 14) return false;
  let visiveis = 0;
  for (let i = 0; i < 14; i++) {
    if (m[i] === "*") continue;
    if (m[i] !== cnpj[i]) return false;
    visiveis++;
  }
  return visiveis >= 6;
}

/**
 * Quem é este lado do comprovante?
 *
 * A ordem importa — o primeiro que decide, decide:
 *  1. CNPJ inteiro. É o único dado que não admite discussão, e é o que salva do
 *     homônimo: se o documento existe e não é nosso, é terceiro, ponto.
 *  2. CNPJ mascarado com dígitos visíveis suficientes.
 *  3. Nome, e só quando ele carrega marca de pessoa jurídica. "COSTA JUNIOR"
 *     seco fica DESCONHECIDO de propósito: melhor o bot perguntar do que chutar.
 */
export function identificarLado(nome?: string | null, doc?: string | null): Identificacao {
  const n = norm(nome);
  const dDoc = digitos(doc);
  // o documento às vezes vem colado no nome ("COSTA JUNIOR 07.132.942/0001-72")
  const dNome = digitos(nome);

  for (const d of [dDoc, dNome]) {
    if (d.length === 14) {
      if (CNPJS_CJR.includes(d) || RAIZES_CJR.includes(d.slice(0, 8))) {
        return { lado: "cjr", forca: "cnpj", motivo: "CNPJ da empresa" };
      }
      return { lado: "terceiro", forca: "cnpj", motivo: "CNPJ de outra empresa" };
    }
    if (d.length === 11) {
      // CPF: pessoa física nunca é a empresa — nem o sócio
      return { lado: "terceiro", forca: "cnpj", motivo: "CPF (pessoa física)" };
    }
  }

  for (const c of CNPJS_CJR) {
    if (casaMascara(String(doc ?? ""), c)) {
      return { lado: "cjr", forca: "mascara", motivo: "CNPJ mascarado confere" };
    }
  }

  if (!n) return { lado: "desconhecido", forca: "nenhuma", motivo: "sem nome" };

  if (SOBRENOME_PESSOA.test(n)) {
    return { lado: "terceiro", forca: "nome", motivo: "sobrenome de pessoa física" };
  }
  if (NOME_CJR.test(n)) {
    if (PALAVRA_EMPRESA.test(n)) {
      return { lado: "cjr", forca: "nome", motivo: "razão social da empresa" };
    }
    // "COSTA JR" sem mais nada pode ser a empresa abreviada ou uma pessoa
    return { lado: "desconhecido", forca: "nenhuma", motivo: "nome ambíguo entre a empresa e o sócio" };
  }
  return { lado: "terceiro", forca: "nome", motivo: "outro nome" };
}

/** Atalho para quem só quer saber se é a empresa. */
export function ehAPropriaCJR(texto: string): boolean {
  return identificarLado(texto, texto).lado === "cjr";
}
