// Catálogo de sistemas/programas que um colaborador pode ter acesso.
// Usado na aba "Acessos" da ficha do colaborador (/admin/rh) e no fluxo de
// desligamento (saber o que revogar). Agrupado por categoria para a UI.
// Para adicionar um sistema fixo, inclua aqui; a ficha também permite adicionar
// um sistema "fora da lista" por colaborador.

export type GrupoSistemas = { categoria: string; itens: string[] };

export const SISTEMAS_CATALOGO: GrupoSistemas[] = [
  { categoria: "Sistemas / Gestão", itens: ["PortalCJR", "Vobi", "Rotaexata", "ControlID", "D4Sign"] },
  { categoria: "Bancos", itens: ["Banco do Brasil", "Bradesco", "Caixa", "Itaú", "Nubank", "Santander", "Sicoob"] },
  { categoria: "Benefícios / Vale-Transporte", itens: ["Alelo", "Caixa VT", "Coopcerto"] },
  { categoria: "Pedágio / Locação de Veículos", itens: ["Veloe", "Semparar", "Localiza", "Movida"] },
  { categoria: "Telefonia", itens: ["Tim", "Vivo"] },
  { categoria: "Mobilidade / Logística", itens: ["Uber", "Lalamove", "Logi"] },
  { categoria: "Compras / Suprimentos", itens: ["Trílogo", "Aquanima", "Ariba", "Carrefour", "Kalunga", "CAU"] },
];

// Lista plana de todos os sistemas do catálogo.
export const SISTEMAS_LISTA: string[] = SISTEMAS_CATALOGO.flatMap((g) => g.itens);

// Mapa sistema -> categoria (para preencher a categoria ao salvar).
export const SISTEMA_CATEGORIA: Record<string, string> = Object.fromEntries(
  SISTEMAS_CATALOGO.flatMap((g) => g.itens.map((s) => [s, g.categoria])),
);

export function categoriaDoSistema(nome: string): string {
  return SISTEMA_CATEGORIA[nome] || "Outros";
}
