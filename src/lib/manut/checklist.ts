// Checklist de manutenção preventiva — Costa Júnior
// Fluxo: foto inicial do técnico uniformizado na loja → 3 disciplinas em sequência
// (Hidráulica → Civil → Elétrica), cada uma com itens e ao menos 5 fotos
// → observações gerais → assinatura do gerente da loja.
//
// Armazenado em manut_preventivas.checklist (jsonb) — gerado quando a
// preventiva é iniciada pela primeira vez. Itens adicionados aqui depois
// NÃO aparecem em preventivas já iniciadas.

export type DisciplinaId = "hidraulica" | "civil" | "eletrica";

export type ChecklistItem = { id: string; label: string };
export type EtapaWizard = "inicial" | "hidraulica" | "civil" | "eletrica" | "estoque" | "assinatura" | "concluido";

export const FOTOS_MIN_POR_DISCIPLINA = 5;

export const DISCIPLINAS: { id: DisciplinaId; nome: string; icone: string; periodicidade: string; itens: ChecklistItem[] }[] = [
  {
    id: "hidraulica",
    nome: "Hidráulica",
    icone: "🔧",
    periodicidade: "mensal / trimestral",
    itens: [
      { id: "hd_vazamentos",   label: "Verificar vazamentos aparentes (torneiras, sifões, registros)" },
      { id: "hd_pressao",      label: "Testar pressão da água em pontos de consumo" },
      { id: "hd_descarga",     label: "Inspecionar funcionamento de válvulas de descarga" },
      { id: "hd_loucas",       label: "Verificar fixação e vedação de louças sanitárias" },
      { id: "hd_ralos",        label: "Limpeza de ralos e grelhas" },
      { id: "hd_desentupir",   label: "Desentupimento simples (sem uso de equipamento especializado)" },
      { id: "hd_sifonada",     label: "Conferir caixa sifonada (odor e escoamento)" },
      { id: "hd_bombas",       label: "Verificar funcionamento de bombas (se houver)" },
      { id: "hd_caixa_agua",   label: "Inspecionar caixa d'água (nível, vedação e limpeza básica visual)" },
      { id: "hd_aquecedor",    label: "Verificar aquecedores (se houver)" },
    ],
  },
  {
    id: "civil",
    nome: "Civil",
    icone: "🧱",
    periodicidade: "mensal / trimestral",
    itens: [
      { id: "cv_trincas",       label: "Inspeção de trincas e fissuras em paredes" },
      { id: "cv_pintura",       label: "Verificar condições de pintura (descascamento, umidade)" },
      { id: "cv_revestimentos", label: "Checar revestimentos (limite: troca pontual de até 1 peça por preventiva)" },
      { id: "cv_rejuntes",      label: "Verificar rejuntes (falhas, infiltração)" },
      { id: "cv_forro",         label: "Inspecionar forro (manchas, desalinhamento, infiltração)" },
      { id: "cv_portas_janelas",label: "Checar portas e janelas (abertura, fechamento, empeno)" },
      { id: "cv_dobradicas",    label: "Ajuste e reaperto de dobradiças" },
      { id: "cv_fechaduras",    label: "Verificar fechaduras e trincos" },
      { id: "cv_suportes",      label: "Fixação de quadros, suportes e itens de parede" },
      { id: "cv_mobiliario",    label: "Reaperto de parafusos em mobiliário" },
      { id: "cv_piso",          label: "Verificar piso (descolamento, trincas, desgaste)" },
      { id: "cv_rodapes",       label: "Checar rodapés e acabamentos" },
      { id: "cv_cobertura",     label: "Inspecionar cobertura/telhado (quando acessível)" },
      { id: "cv_esquadrias",    label: "Verificar vedação de esquadrias" },
    ],
  },
  {
    id: "eletrica",
    nome: "Elétrica",
    icone: "⚡",
    periodicidade: "mensal",
    itens: [
      { id: "el_iluminacao",      label: "Verificar funcionamento geral da iluminação" },
      { id: "el_lampadas",        label: "Substituição de lâmpadas queimadas" },
      { id: "el_interruptores",   label: "Testar interruptores e tomadas" },
      { id: "el_aquecimento",     label: "Verificar aquecimento anormal em tomadas" },
      { id: "el_quadro",          label: "Inspecionar quadro elétrico" },
      { id: "el_disjuntores",     label: "Reaperto de disjuntores no quadro" },
      { id: "el_circuitos",       label: "Identificação e organização dos circuitos" },
      { id: "el_dr",              label: "Testar dispositivos DR (se houver)" },
      { id: "el_cabos",           label: "Verificar cabos aparentes (desgaste ou exposição)" },
      { id: "el_equipamentos",    label: "Testar equipamentos elétricos fixos" },
      { id: "el_emergencia",      label: "Verificar funcionamento de iluminação de emergência" },
      { id: "el_estabilizadores", label: "Testar estabilizadores/no-breaks (se houver)" },
    ],
  },
];

export const ORDEM_ETAPAS: EtapaWizard[] = ["inicial", "hidraulica", "civil", "eletrica", "estoque", "assinatura", "concluido"];

export type ChecklistDisciplina = {
  itens: Array<ChecklistItem & { ok: boolean | null; obs: string }>;
  fotos: string[]; // URLs
  observacoes: string;
};

export type ChecklistData = {
  etapa_atual: EtapaWizard;
  foto_inicial_url: string | null;
  disciplinas: Record<DisciplinaId, ChecklistDisciplina>;
  observacoes_gerais: string;
  gerente_nome: string;
  gerente_cargo: string;
  gerente_assinatura_url: string | null;
  iniciado_em: string;
  concluido_em: string | null;
};

export function checklistInicial(): ChecklistData {
  const disciplinas = {} as Record<DisciplinaId, ChecklistDisciplina>;
  for (const d of DISCIPLINAS) {
    disciplinas[d.id] = {
      itens: d.itens.map((it) => ({ ...it, ok: null as boolean | null, obs: "" })),
      fotos: [],
      observacoes: "",
    };
  }
  return {
    etapa_atual: "inicial",
    foto_inicial_url: null,
    disciplinas,
    observacoes_gerais: "",
    gerente_nome: "",
    gerente_cargo: "",
    gerente_assinatura_url: null,
    iniciado_em: new Date().toISOString(),
    concluido_em: null,
  };
}

export function proximaEtapa(atual: EtapaWizard): EtapaWizard {
  const idx = ORDEM_ETAPAS.indexOf(atual);
  if (idx < 0 || idx === ORDEM_ETAPAS.length - 1) return atual;
  return ORDEM_ETAPAS[idx + 1];
}
