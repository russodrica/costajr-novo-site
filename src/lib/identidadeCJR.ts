// Reconhecer a PRÓPRIA Costa Júnior num comprovante.
//
// Mora num módulo só dela, sem dependência nenhuma, por dois motivos: é usada
// dos dois lados (pagamento feito, recebimento, transferência entre contas) e
// precisa ser testável sozinha — o resto do financeiro arrasta uma cadeia de
// imports que só carrega sob o Astro.

/** CNPJ da Costa Júnior Engenharia — só a raiz, que é o que nunca muda. */
export const CNPJ_CJR = "07132942";

/** Tira acento, hífen e ponto, e normaliza o espaço. */
function limpar(texto: string): string {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // "Júnior" -> "Junior"
    .replace(/[-_./]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * O texto se refere à própria empresa (e não a um terceiro)?
 *
 * DOIS CUIDADOS que a auditoria de 17/09/2026 expôs:
 *
 *  1. O SÓCIO se chama JOSE FERREIRA DA COSTA JUNIOR e recebe pagamentos da
 *     empresa (há "HONORÁRIO DIRETORIA" em aberto, e ele está no cadastro de
 *     clientes com o id 235730). A regra antiga casava o nome dele — um
 *     pagamento ao sócio viraria "transferência entre contas próprias". Por
 *     isso o "DA/DE COSTA JUNIOR", construção de sobrenome de pessoa, é
 *     descartado ANTES de qualquer outra coisa.
 *
 *  2. O comprovante vem com acento decomposto, hífen, razão social cortada
 *     ("COSTA JUNIOR ENGENHARIA E CONSTRUCOE...") e CNPJ mascarado
 *     ("07.******(barra)****-72"). Normalizamos, e casamos também pela raiz do
 *     CNPJ quando ela aparece inteira — é o identificador que não admite
 *     discussão. Mascarado não conta: "07" sozinho não prova nada.
 */
export function ehAPropriaCJR(texto: string): boolean {
  const t = limpar(texto);
  if (!t) return false;
  if (t.replace(/\D/g, "").includes(CNPJ_CJR)) return true;
  if (/\bd[aeo]s?\s+costa\s+junior\b/i.test(t)) return false; // pessoa física
  return /\bcosta\s*junior\b|\bcostajr\b|\bcosta\s*jr\b|\bc\s*junior\s+eng/i.test(t);
}

/**
 * Quem é este lado do comprovante?
 *
 * Existe porque a resposta muda o que o bot faz: a CJU pagando é uma DESPESA a
 * baixar, a CJR recebendo é uma RECEITA a baixar, e a CJR dos dois lados é uma
 * transferência entre contas próprias, que não tem lançamento e precisa ser
 * criada.
 */
export type Lado = "cjr" | "terceiro" | "desconhecido";

export function quemE(texto?: string | null): Lado {
  const t = limpar(String(texto || ""));
  if (t.length < 3) return "desconhecido";
  return ehAPropriaCJR(t) ? "cjr" : "terceiro";
}
