// ============================================================================
// Slots de documento do RH — ESPELHA a ficha do colaborador (rh.astro SLOTS_DOC).
// O que faz um documento "cair" no slot certo é o PREFIXO do título: a ficha usa
// slotDoDoc() que casa por prefixo. Então, para anexar no lugar certo, o título
// precisa ser `${prefixo} — ${arquivo}` e o tipo = o tipo do slot.
// Esta lib é importada pela página /admin/caixa-entrada e pelos endpoints de sugestão.
// ============================================================================

export type SlotDoc = { key: string; label: string; tipo: string; prefixo: string; validade: boolean };

export const SLOTS_DOC: SlotDoc[] = [
  { key: "contrato", label: "Contrato / Termo", tipo: "contrato", prefixo: "Contrato/Termo", validade: false },
  { key: "rg_hab", label: "RG / Habilitação (CNH)", tipo: "cnh", prefixo: "RG/Habilitação", validade: false },
  { key: "ficha_registro", label: "Ficha de Registro", tipo: "outro", prefixo: "Ficha de Registro", validade: false },
  { key: "carteira_trabalho", label: "Carteira de Trabalho (CTPS)", tipo: "outro", prefixo: "Carteira de Trabalho", validade: false },
  { key: "titulo_eleitor", label: "Título de Eleitor", tipo: "outro", prefixo: "Título de Eleitor", validade: false },
  { key: "certidao_nascimento", label: "Certidão (nascimento/casamento)", tipo: "outro", prefixo: "Certidão de Nascimento", validade: false },
  { key: "comprovante_residencia", label: "Comprovante de Residência", tipo: "outro", prefixo: "Comprovante de Residência", validade: false },
  { key: "teste", label: "Teste de Personalidade", tipo: "outro", prefixo: "Teste de Personalidade", validade: false },
  { key: "aso", label: "ASO (exame médico)", tipo: "aso", prefixo: "ASO", validade: true },
  { key: "os", label: "Ordem de Serviço", tipo: "outro", prefixo: "Ordem de Serviço", validade: false },
  { key: "nr35", label: "NR-35 · Trabalho em Altura", tipo: "certificado", prefixo: "NR35", validade: true },
  { key: "nr10", label: "NR-10 · Eletricidade", tipo: "certificado", prefixo: "NR10", validade: true },
  { key: "nr06", label: "NR-06 · EPI", tipo: "certificado", prefixo: "NR06", validade: true },
  { key: "nr01", label: "NR-01 · GRO/PGR", tipo: "certificado", prefixo: "NR01", validade: true },
  { key: "advertencia", label: "Advertência", tipo: "advertencia", prefixo: "Advertência", validade: false },
  { key: "suspensao", label: "Suspensão", tipo: "outro", prefixo: "Suspensão", validade: false },
  { key: "ficha_epi", label: "Ficha de EPI", tipo: "ficha_epi", prefixo: "Ficha de EPI", validade: false },
  { key: "outro", label: "Outro documento", tipo: "outro", prefixo: "Documento", validade: false },
];

export const slotPorKey = (key: string): SlotDoc | undefined => SLOTS_DOC.find((s) => s.key === key);

const norm = (s: string) =>
  String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[_().-]/g, " ").replace(/\s+/g, " ").trim();

// Tenta deduzir o slot a partir de um texto (nome do arquivo, ou texto extraído pela IA).
export function detectarSlotPorTexto(texto: string): string | null {
  const t = norm(texto);
  if (!t) return null;
  // Mais específico primeiro
  // Ficha de EPI ANTES do NR-06: o documento "Controle/Entrega de EPI" vai para a
  // aba EPIs (tipo ficha_epi), mesmo quando o nome cita "NR6" junto.
  if (/ficha de epi|ficha epi|entrega de epi|controle de epi|controle de entrega de epi/.test(t)) return "ficha_epi";
  if (/\bnr\s*35\b|altura/.test(t)) return "nr35";
  if (/\bnr\s*10\b|eletric/.test(t)) return "nr10";
  if (/\bnr\s*0?6\b/.test(t)) return "nr06";
  if (/\bnr\s*0?1\b|\bgro\b|\bpgr\b/.test(t)) return "nr01";
  if (/\baso\b|exame medico|atestado de saude ocupacional/.test(t)) return "aso";
  if (/\bcnh\b|habilita|carteira de motorista|carteira nacional/.test(t)) return "rg_hab";
  if (/\brg\b|identidade/.test(t)) return "rg_hab";
  if (/\bctps\b|carteira de trabalho/.test(t)) return "carteira_trabalho";
  if (/titulo de eleitor|titulo eleitor|\beleitor\b/.test(t)) return "titulo_eleitor";
  if (/certidao|nascimento|casamento/.test(t)) return "certidao_nascimento";
  if (/comprovante|residencia|endereco/.test(t)) return "comprovante_residencia";
  if (/ficha de registro|\bregistro\b/.test(t)) return "ficha_registro";
  if (/personalidade|teste disc|eneagrama/.test(t)) return "teste";
  if (/ordem de servico|\bos\b/.test(t)) return "os";
  if (/advertencia/.test(t)) return "advertencia";
  if (/suspensao/.test(t)) return "suspensao";
  if (/contrato|\btermo\b|admiss/.test(t)) return "contrato";
  return null;
}

// Extrai uma data de validade (dd/mm/aaaa, dd-mm-aaaa, aaaa-mm-dd) de um texto, em ISO (aaaa-mm-dd).
export function detectarValidade(texto: string): string | null {
  const t = String(texto || "");
  let m = t.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = t.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

// Casa um texto (nome do arquivo) com a lista de colaboradores por nome.
// Retorna { id, nome, score } do melhor casamento, ou null.
export function casarColaborador(
  texto: string,
  colaboradores: { id: string; nome: string }[],
): { id: string; nome: string; score: number } | null {
  const alvo = norm(texto);
  if (!alvo) return null;
  const tokensAlvo = alvo.split(" ").filter((w) => w.length >= 3);
  let melhor: { id: string; nome: string; score: number } | null = null;
  const porPrimeiroNome: { id: string; nome: string }[] = [];
  for (const c of colaboradores) {
    const nomeN = norm(c.nome);
    if (!nomeN) continue;
    const partes = nomeN.split(" ").filter((w) => w.length >= 3);
    if (!partes.length) continue;
    // nome completo contido no texto → casamento forte
    let score = 0;
    if (alvo.includes(nomeN)) score = 100;
    else {
      const casados = partes.filter((p) => tokensAlvo.includes(p)).length;
      // exige pelo menos 2 partes do nome (ou 1 se o nome só tem 1 token)
      if (casados >= 2 || (partes.length === 1 && casados === 1)) score = 40 + casados * 15;
    }
    if (score > 0 && (!melhor || score > melhor.score)) melhor = { id: c.id, nome: c.nome, score };
    // candidato por PRIMEIRO NOME (fallback p/ legenda tipo "Givanildo - desconto folha")
    if (partes[0] && tokensAlvo.includes(partes[0])) porPrimeiroNome.push({ id: c.id, nome: c.nome });
  }
  if (melhor) return melhor;
  // Sem casamento forte: aceita o PRIMEIRO NOME só se houver UM único colaborador com
  // esse primeiro nome (evita ambiguidade — se dois "Givanildo", não chuta).
  if (porPrimeiroNome.length === 1) return { ...porPrimeiroNome[0], score: 30 };
  return null;
}
