// Testes de perfil comportamental — DISC e Eneagrama.
// Versões próprias (genéricas) para triagem de candidatos. Não substituem
// avaliação profissional; servem como sinal complementar no recrutamento.

// ─────────────────────────── DISC ───────────────────────────
// Formato escolha-forçada: em cada grupo o candidato escolhe a palavra que MAIS
// o descreve. Cada palavra pontua uma dimensão D/I/S/C. Dominante = maior soma.
export type DiscDim = "D" | "I" | "S" | "C";
export interface DiscGrupo { id: number; opcoes: { t: string; d: DiscDim }[]; }

export const DISC_GRUPOS: DiscGrupo[] = [
  { id: 1, opcoes: [{ t: "Decidido", d: "D" }, { t: "Animado", d: "I" }, { t: "Paciente", d: "S" }, { t: "Preciso", d: "C" }] },
  { id: 2, opcoes: [{ t: "Competitivo", d: "D" }, { t: "Comunicativo", d: "I" }, { t: "Leal", d: "S" }, { t: "Cuidadoso", d: "C" }] },
  { id: 3, opcoes: [{ t: "Direto", d: "D" }, { t: "Otimista", d: "I" }, { t: "Estável", d: "S" }, { t: "Analítico", d: "C" }] },
  { id: 4, opcoes: [{ t: "Ousado", d: "D" }, { t: "Persuasivo", d: "I" }, { t: "Calmo", d: "S" }, { t: "Detalhista", d: "C" }] },
  { id: 5, opcoes: [{ t: "Objetivo", d: "D" }, { t: "Entusiasmado", d: "I" }, { t: "Cooperativo", d: "S" }, { t: "Organizado", d: "C" }] },
  { id: 6, opcoes: [{ t: "Determinado", d: "D" }, { t: "Sociável", d: "I" }, { t: "Compreensivo", d: "S" }, { t: "Disciplinado", d: "C" }] },
  { id: 7, opcoes: [{ t: "Assertivo", d: "D" }, { t: "Expressivo", d: "I" }, { t: "Constante", d: "S" }, { t: "Metódico", d: "C" }] },
  { id: 8, opcoes: [{ t: "Corajoso", d: "D" }, { t: "Inspirador", d: "I" }, { t: "Acolhedor", d: "S" }, { t: "Rigoroso", d: "C" }] },
  { id: 9, opcoes: [{ t: "Focado em resultado", d: "D" }, { t: "Carismático", d: "I" }, { t: "Previsível", d: "S" }, { t: "Perfeccionista", d: "C" }] },
  { id: 10, opcoes: [{ t: "Independente", d: "D" }, { t: "Falante", d: "I" }, { t: "Tranquilo", d: "S" }, { t: "Cauteloso", d: "C" }] },
  { id: 11, opcoes: [{ t: "Exigente", d: "D" }, { t: "Espontâneo", d: "I" }, { t: "Gentil", d: "S" }, { t: "Lógico", d: "C" }] },
  { id: 12, opcoes: [{ t: "Confiante", d: "D" }, { t: "Divertido", d: "I" }, { t: "Atencioso", d: "S" }, { t: "Sistemático", d: "C" }] },
  { id: 13, opcoes: [{ t: "Pioneiro", d: "D" }, { t: "Convincente", d: "I" }, { t: "Conciliador", d: "S" }, { t: "Exato", d: "C" }] },
  { id: 14, opcoes: [{ t: "Enérgico", d: "D" }, { t: "Caloroso", d: "I" }, { t: "Equilibrado", d: "S" }, { t: "Reservado", d: "C" }] },
  { id: 15, opcoes: [{ t: "Firme", d: "D" }, { t: "Extrovertido", d: "I" }, { t: "Dedicado", d: "S" }, { t: "Criterioso", d: "C" }] },
  { id: 16, opcoes: [{ t: "Empreendedor", d: "D" }, { t: "Popular", d: "I" }, { t: "Sereno", d: "S" }, { t: "Formal", d: "C" }] },
];

export interface DiscResultado { D: number; I: number; S: number; C: number; dominante: DiscDim; sigla: string; }
export const DISC_LABEL: Record<DiscDim, string> = { D: "Dominância (D)", I: "Influência (I)", S: "Estabilidade (S)", C: "Conformidade (C)" };
export const DISC_DESC: Record<DiscDim, string> = {
  D: "Foco em resultados, decisão e ação. Gosta de desafios, ritmo rápido e autonomia.",
  I: "Foco em pessoas e comunicação. Entusiasta, persuasivo e otimista; motiva equipes.",
  S: "Foco em estabilidade e cooperação. Paciente, leal e confiável; bom em rotinas e suporte.",
  C: "Foco em qualidade e precisão. Analítico, organizado e detalhista; preza por regras e padrões.",
};

export function calcularDisc(respostas: Record<string, DiscDim>): DiscResultado {
  const c: Record<DiscDim, number> = { D: 0, I: 0, S: 0, C: 0 };
  for (const g of DISC_GRUPOS) { const r = respostas[String(g.id)]; if (r && c[r] !== undefined) c[r]++; }
  const dominante = (Object.keys(c) as DiscDim[]).reduce((a, b) => (c[b] > c[a] ? b : a), "D");
  return { ...c, dominante, sigla: DISC_LABEL[dominante] };
}

// ─────────────────────────── ENEAGRAMA ───────────────────────────
// 27 afirmações (3 por tipo). O candidato concorda de 1 (discordo) a 5 (concordo).
// Tipo = maior soma. Empate resolve pelo tipo de menor número (estável).
export interface EneaItem { tipo: number; t: string; }
export const ENEAGRAMA_ITENS: EneaItem[] = [
  { tipo: 1, t: "Tenho um forte senso do que é certo e errado e me incomodo com erros." },
  { tipo: 1, t: "Procuro fazer as coisas da forma correta, mesmo que dê mais trabalho." },
  { tipo: 1, t: "Sou organizado e autocrítico; busco melhorar sempre." },
  { tipo: 2, t: "Gosto de ajudar as pessoas e percebo facilmente o que elas precisam." },
  { tipo: 2, t: "Me sinto bem quando sou útil e reconhecido pelos outros." },
  { tipo: 2, t: "Coloco as necessidades dos outros muitas vezes à frente das minhas." },
  { tipo: 3, t: "Sou movido por metas e gosto de alcançar resultados visíveis." },
  { tipo: 3, t: "Me importo com a imagem que passo e com o sucesso." },
  { tipo: 3, t: "Sou eficiente e me adapto para vencer os desafios." },
  { tipo: 4, t: "Valorizo a autenticidade e gosto de expressar quem realmente sou." },
  { tipo: 4, t: "Sinto as emoções de forma intensa e profunda." },
  { tipo: 4, t: "Busco sentido e significado naquilo que faço." },
  { tipo: 5, t: "Gosto de entender as coisas a fundo antes de agir." },
  { tipo: 5, t: "Preservo minha energia e privacidade; observo antes de participar." },
  { tipo: 5, t: "Prefiro analisar com lógica e dados a decidir pela emoção." },
  { tipo: 6, t: "Penso nos riscos e me preparo para o que pode dar errado." },
  { tipo: 6, t: "Valorizo confiança, lealdade e segurança nas relações." },
  { tipo: 6, t: "Gosto de regras claras e de saber em quem posso confiar." },
  { tipo: 7, t: "Sou otimista e gosto de novidades, variedade e experiências." },
  { tipo: 7, t: "Tenho muitas ideias e me entusiasmo com possibilidades." },
  { tipo: 7, t: "Evito o tédio e busco manter o ânimo elevado." },
  { tipo: 8, t: "Sou direto, gosto de assumir o controle e proteger os meus." },
  { tipo: 8, t: "Não tenho medo de confronto quando preciso defender algo." },
  { tipo: 8, t: "Gosto de independência e de tomar minhas próprias decisões." },
  { tipo: 9, t: "Busco harmonia e evito conflitos sempre que possível." },
  { tipo: 9, t: "Sou tranquilo, sei ouvir e acolho diferentes pontos de vista." },
  { tipo: 9, t: "Me adapto com facilidade e priorizo a paz do grupo." },
];

export const ENEAGRAMA_NOMES: Record<number, string> = {
  1: "Tipo 1 — Perfeccionista", 2: "Tipo 2 — Prestativo", 3: "Tipo 3 — Realizador",
  4: "Tipo 4 — Individualista", 5: "Tipo 5 — Investigador", 6: "Tipo 6 — Questionador",
  7: "Tipo 7 — Entusiasta", 8: "Tipo 8 — Desafiador", 9: "Tipo 9 — Pacificador",
};
export const ENEAGRAMA_DESC: Record<number, string> = {
  1: "Íntegro, organizado e orientado a padrões. Forte senso de certo e errado.",
  2: "Empático e generoso. Motivado por ajudar e ser valorizado.",
  3: "Ambicioso e eficiente. Focado em metas, imagem e resultados.",
  4: "Sensível e autêntico. Busca significado e expressão pessoal.",
  5: "Analítico e reservado. Busca conhecimento e autonomia.",
  6: "Leal e cauteloso. Valoriza segurança, confiança e preparo.",
  7: "Otimista e versátil. Cheio de ideias e energia para o novo.",
  8: "Assertivo e protetor. Gosta de controle e de liderar.",
  9: "Conciliador e calmo. Busca harmonia e evita conflitos.",
};

export interface EneaResultado { tipo: number; nome: string; scores: Record<number, number>; }
export function calcularEneagrama(respostas: Record<string, number>): EneaResultado {
  const scores: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 };
  ENEAGRAMA_ITENS.forEach((it, i) => { const v = Number(respostas[String(i)] || 0); if (v >= 1 && v <= 5) scores[it.tipo] += v; });
  let tipo = 1; for (let t = 2; t <= 9; t++) if (scores[t] > scores[tipo]) tipo = t;
  return { tipo, nome: ENEAGRAMA_NOMES[tipo], scores };
}
