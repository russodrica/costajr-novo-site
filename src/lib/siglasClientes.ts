// ════════════════════════════════════════════════════════════════════════
// Siglas dos clientes recorrentes — Adriana, 05/08/2026.
//
// Usadas em TRÊS lugares, pra tudo ficar no mesmo padrão dos arquivos de
// projeto da casa (CRF-XBI-ARQ-REF-100-R00.pdf):
//   1. nome da pasta criada em _CLAUDE COMERCIAL
//   2. nome do arquivo da proposta em PowerPoint
//   3. nome da oportunidade criada na Vobi
//
// O CONTEÚDO da proposta continua com o nome do cliente por extenso — a
// sigla é padrão interno, não é o que o cliente lê.
//
// Cliente que não estiver aqui segue com o nome completo, como sempre foi.
// Pra acrescentar um novo: é só somar uma linha no mapa abaixo.
// ════════════════════════════════════════════════════════════════════════

export const SIGLAS_CLIENTES: Record<string, string> = {
  CARREFOUR: "CRF",
  SANTANDER: "STD",
  COHAB: "CHB",
  "SMART FIT": "SFT",
};

// Tira acento, caixa, pontuação e espaço — assim "Carrefour Express S/A",
// "CARREFOUR EXPRESS" e "smart-fit" caem todos no mesmo lugar.
function chaveDeBusca(s: string): string {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Devolve a sigla do cliente, ou null se ele não for um dos recorrentes.
export function siglaDoCliente(nome: string): string | null {
  const alvo = chaveDeBusca(nome);
  if (!alvo) return null;
  for (const [cliente, sigla] of Object.entries(SIGLAS_CLIENTES)) {
    if (alvo.includes(chaveDeBusca(cliente))) return sigla;
  }
  return null;
}

// O que vai pra pasta, pro arquivo e pra Vobi: a sigla quando existir,
// senão o nome completo do cliente.
export function nomeCurtoCliente(nome: string): string {
  return siglaDoCliente(nome) || String(nome || "").trim();
}
