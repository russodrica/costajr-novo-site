// Itens de Depósito — vendas em Marketplace/OLX: anúncio pronto + central de perguntas.
// As perguntas ficam em perguntas.json no mesmo bucket privado do catálogo.
import { ITENS_BUCKET, type ItemDeposito } from "./itensDeposito";
import { gerarTextoLLM, llmConfigurado } from "./llm";

export type Pergunta = {
  id: string;
  em: string;
  canal: "Marketplace" | "OLX" | "Outro";
  n: number | null; // item do catálogo
  comprador: string;
  pergunta: string;
  resposta: string;
  tipo: string; // entrega | retirada | disponibilidade | preco | outra
  status: "pendente" | "decidir" | "respondida";
};

export async function lerPerguntas(db: any): Promise<Pergunta[]> {
  try {
    const { data, error } = await db.storage.from(ITENS_BUCKET).download("perguntas.json");
    if (error || !data) return [];
    return JSON.parse(await data.text());
  } catch {
    return [];
  }
}

export async function gravarPerguntas(db: any, lista: Pergunta[]): Promise<void> {
  const body = new Blob([JSON.stringify(lista)], { type: "application/json" });
  const { error } = await db.storage.from(ITENS_BUCKET).upload("perguntas.json", body, { upsert: true, contentType: "application/json" });
  if (error) throw new Error("Não consegui gravar as perguntas: " + error.message);
}

export const REGRA_ENTREGA =
  "Não faço entrega pessoalmente nem em estação de metrô. A entrega é somente por motoboy ou Lalamove, chamado por sua conta: o entregador retira o item aqui e o frete é pago por você diretamente ao entregador.";

const brl = (v: number) => "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Itens pequenos e baratos (plugs, tampas, tomadas, luvas...) só saem em lote fechado.
export const LIMITE_MIUDO = 15;
export function ehMiudo(it: ItemDeposito): boolean {
  return it.valor != null && it.un === "un" && it.valor <= LIMITE_MIUDO && it.qtd > 1;
}
const REGRA_LOTE = "Vendido SOMENTE o lote completo, não vendo unidades avulsas.";

export function rotuloValor(it: ItemDeposito): string {
  if (it.valor == null) return "";
  if (ehMiudo(it)) return `${brl(Math.round(it.valor * it.qtd * 100) / 100)} pelo lote de ${String(it.qtd).replace(".", ",")} un`;
  const un = it.un;
  const r = un === "lote" || un === "conj" || un === "kit" ? `do ${un}` : un === "un" ? "unitário" : `por ${un}`;
  return `${brl(it.valor)} (valor ${r})`;
}

export function montarAnuncio(it: ItemDeposito) {
  const qtd = String(it.qtd).replace(".", ",");
  const marcaUtil = it.marca && it.marca !== "-" ? it.marca : "";
  const titulo = (marcaUtil && !it.nome.toLowerCase().includes(marcaUtil.toLowerCase().split(" ")[0]) ? `${it.nome} - ${marcaUtil}` : it.nome).slice(0, 90);
  const linhas = [
    it.nome + (marcaUtil ? ` — ${marcaUtil}` : ""),
    `Condição: ${it.cond}`,
    ehMiudo(it) ? `LOTE COM ${qtd} UNIDADES — ${REGRA_LOTE}` : `Quantidade disponível: ${qtd} ${it.un}`,
    it.valor != null ? `Valor: ${rotuloValor(it)}` : "",
    "",
    "ENTREGA: " + REGRA_ENTREGA,
    "Pagamento via Pix antes da retirada pelo entregador.",
    "Dúvidas? É só perguntar por aqui.",
  ].filter((l) => l !== null);
  const tituloFinal = ehMiudo(it) ? `Lote com ${qtd} - ${titulo}`.slice(0, 90) : titulo;
  const preco = it.valor != null && ehMiudo(it) ? Math.round(it.valor * it.qtd * 100) / 100 : it.valor;
  return { titulo: tituloFinal, descricao: linhas.join("\n"), preco };
}

export function classificar(p: string): string {
  const t = p.toLowerCase();
  if (/(desconto|abaixa|menos|[uú]ltimo|aceita|negoci|troca|pre[cç]o final|faz por|leva (tudo|os)|parcel|cart[aã]o)/.test(t)) return "preco";
  if (/(frete|entrega|envia|enviar|correio|sedex|transportadora|motoboy|uber|lalamove)/.test(t)) return "entrega";
  if (/(retirar|retirada|buscar|pegar|endere[cç]o|onde fica|onde [eé]|local|metr[oô]|esta[cç][aã]o|encontr|combinar)/.test(t)) return "retirada";
  if (/(dispon[ií]vel|ainda tem|ainda est[aá]|tem ainda|vendid)/.test(t)) return "disponibilidade";
  return "outra";
}

export async function sugerirResposta(
  pergunta: string,
  it: ItemDeposito | null,
): Promise<{ tipo: string; resposta: string; status: Pergunta["status"] }> {
  const tipo = classificar(pergunta);
  if (it && ehMiudo(it) && /(unidade|avulso|avulsa|s[oó] (uma?|duas?|\d+)|quantas|parte|metade|alguns|algumas)/i.test(pergunta))
    return {
      tipo: "lote", status: "pendente",
      resposta: `Olá! Esse item é vendido somente em lote fechado, com ${it.qtd} ${it.un}, por ${rotuloValor(it)}. Não separo unidades avulsas. ${REGRA_ENTREGA}`,
    };
  if (tipo === "preco")
    return { tipo, status: "decidir", resposta: "Olá! Obrigada pelo interesse. Vou verificar essa condição e já te retorno." };
  if (tipo === "entrega")
    return { tipo, status: "pendente", resposta: "Olá! " + REGRA_ENTREGA + " Se quiser, me diga o item e eu confirmo a disponibilidade." };
  if (tipo === "retirada")
    return { tipo, status: "pendente", resposta: "Olá! " + REGRA_ENTREGA + " O endereço de retirada eu passo para o entregador depois que o pagamento for confirmado." };
  if (tipo === "disponibilidade") {
    if (it && it.status === "disponivel") return { tipo, status: "pendente", resposta: `Olá! Sim, ainda está disponível (${ehMiudo(it) ? `lote fechado com ${it.qtd} ${it.un}, por ${rotuloValor(it)}` : `${it.qtd} ${it.un}`}). ${REGRA_ENTREGA}` };
    if (it) return { tipo, status: "pendente", resposta: "Olá! Esse item já foi vendido, obrigada pelo interesse." };
    return { tipo, status: "decidir", resposta: "" };
  }
  // dúvida sobre o item: usa o modelo só com os dados cadastrados
  if (it && llmConfigurado()) {
    const ficha = `Item: ${it.nome}\nMarca: ${it.marca}\nCondição: ${it.cond}\nQuantidade: ${it.qtd} ${it.un}\nValor: ${rotuloValor(it)}`;
    const sys =
      "Você responde, em português do Brasil, dúvidas de compradores de um anúncio de material de obra usado/novo. Responda curto e educado, usando SOMENTE os dados da ficha. Se a dúvida pedir algo que não está na ficha (nota fiscal, garantia, medidas, teste de funcionamento, etc.), responda exatamente: SEM_DADOS. Nunca invente, nunca informe endereço, nunca ofereça entrega pessoal nem retirada pelo comprador: a entrega é só por motoboy/Lalamove por conta do comprador.\n\n" +
      ficha;
    const r = (await gerarTextoLLM(sys, [{ role: "user", content: pergunta }]))?.trim();
    if (r && !r.includes("SEM_DADOS")) return { tipo, status: "pendente", resposta: r };
  }
  return { tipo, status: "decidir", resposta: "Olá! Obrigada pelo contato. Vou confirmar essa informação e já te retorno." };
}
