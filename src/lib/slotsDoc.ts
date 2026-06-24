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

// Colapsa siglas pontuadas de uma letra por vez: "D. R. E." → "DRE", "S.A." → "SA"
// Exige pelo menos 2 componentes (X. Y.) para não tocar abreviações isoladas como "Dr."
const colapsarSiglas = (s: string): string =>
  s.replace(/\b((?:[A-Za-zÀ-ÿ]\. ?)+[A-Za-zÀ-ÿ]\.)/g, (m) => m.replace(/[. ]/g, ""));

const norm = (s: string) =>
  colapsarSiglas(String(s || "")).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[_().-]/g, " ").replace(/\s+/g, " ").trim();

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

// Detecta documento DA EMPRESA pelo TIPO e já devolve a CATEGORIA do módulo
// "Documentos da Empresa" onde ele deve ser arquivado. Esses docs trazem o nome do
// sócio/dono (ex.: José Ferreira da Costa Júnior) no corpo, o que fazia o robô sugerir
// a PESSOA errada — quando bate aqui, não se sugere pessoa e dá p/ arquivar direto.
export function categoriaEmpresaPorTexto(texto: string): { categoria: string; rotulo: string } | null {
  const t = norm(texto);
  if (/\bcnd\b|certidao|certidoes|\bcrf\b|negativa de debito|regularidade do fgts/.test(t)) return { categoria: "Certidões", rotulo: "certidão" };
  if (/\bpgdas\b|\bdefis\b|\bdarf\b|\bdctf\b|guia (de )?(inss|fgts|gfip)|\bissqn?\b|guia de recolhimento|obrigac(ao|oes) fiscal|\bgfip\b/.test(t)) return { categoria: "Guias e Obrigações Fiscais", rotulo: "guia/obrigação fiscal" };
  if (/\bbalancete\b|balanco patrimonial|\bbalanco\b|\bdre\b|demonstrac|razao contabil|livro (caixa|diario)|fluxo de caixa|apuracao|\bsped\b|\becf\b|faturamento|analise patrimonial/.test(t)) return { categoria: "Documentos Contábeis", rotulo: "documento contábil" };
  if (/contrato social|alteracao contratual|cartao cnpj|inscricao (estadual|municipal)|cadastro de contribuinte|escritura|estatuto social|ficha cadastral|domicilio bancario|situacao fiscal|\bduns\b|\bcrea\b|\bcau\b/.test(t)) return { categoria: "Documentos da Empresa", rotulo: "documento cadastral" };
  return null;
}
export function ehDocEmpresa(texto: string): boolean { return categoriaEmpresaPorTexto(texto) !== null; }

// Extrai uma data de validade (dd/mm/aaaa, dd-mm-aaaa, aaaa-mm-dd) de um texto, em ISO (aaaa-mm-dd).
export function detectarValidade(texto: string): string | null {
  const t = String(texto || "");
  let m = t.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = t.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

// Palavras que NÃO ajudam a identificar a pessoa/empresa e poluem o casamento:
// o nome da própria empresa (aparece em TODO documento, e "Costa Júnior" = nome do
// fundador → casava balancete da empresa com a pessoa) e marcadores de plataforma de
// assinatura / genéricos (D4Sign, Clicksign… no nome do arquivo).
const STOP_NOME = new Set([
  "costa", "junior", "engenharia", "construcoes", "construcao", "ltda", "eireli", "epp",
  "d4sign", "clicksign", "docusign", "zapsign", "digiforte", "assinado", "assinada", "signed", "rubrica",
  "balancete", "documento", "arquivo", "scan", "camscanner", "digitalizado", "via", "pdf",
]);

// Detecta extrato bancário pelo nome do arquivo / legenda. Devolve banco canônico + mês/ano.
const MESES_PT: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
  jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6,
  jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
};
// Nomes canônicos = BANCOS em doc-bancarios.astro (deve bater exato para filtrar corretamente)
const BANCOS_MAP: [RegExp, string][] = [
  [/banco\s+do\s+brasil|\bbb\b/, "Banco do Brasil"],
  [/caixa\s+econom|\bcef\b|caixa\s+federal/, "Caixa Econômica Federal"],
  [/santan/, "Santander"],
  [/sicoob/, "Sicoob"],
  [/bradesco/, "Bradesco"],
  [/ita[u]/, "Itaú"],
  [/nubank/, "Nubank"],
];
export function detectarExtratoBancario(texto: string): { banco: string; mes: number; ano: number } | null {
  const t = norm(texto);
  const ehExtrato = /extrato|comprovante\s+bancario|demonstrativo\s+bancario|saldo\s+bancario/.test(t);
  if (!ehExtrato) return null;
  let banco: string | null = null;
  for (const [re, nome] of BANCOS_MAP) { if (re.test(t)) { banco = nome; break; } }
  if (!banco) return null;
  let mes = 0, ano = 0;
  for (const [nomeMes, num] of Object.entries(MESES_PT)) {
    const re = new RegExp(`\\b${nomeMes}\\b[\\s/\\-]*(20\\d{2})`, "i");
    const m = t.match(re); if (m) { mes = num; ano = Number(m[1]); break; }
  }
  if (!mes) { const m = t.match(/\b(0?[1-9]|1[0-2])\/(20\d{2})\b/); if (m) { mes = Number(m[1]); ano = Number(m[2]); } }
  if (!mes) { const m = t.match(/\b(20\d{2})-(0?[1-9]|1[0-2])\b/); if (m) { ano = Number(m[1]); mes = Number(m[2]); } }
  if (!mes || !ano) return null;
  return { banco, mes, ano };
}

// Casa um texto (nome do arquivo / conteúdo) com a lista de colaboradores (ou empresas)
// por nome. Retorna { id, nome, score } do melhor casamento, ou null.
export function casarColaborador(
  texto: string,
  colaboradores: { id: string; nome: string }[],
): { id: string; nome: string; score: number } | null {
  const tokensAlvo = norm(texto).split(" ").filter((w) => w.length >= 3 && !STOP_NOME.has(w));
  const alvo = tokensAlvo.join(" ");
  if (!alvo) return null;
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
