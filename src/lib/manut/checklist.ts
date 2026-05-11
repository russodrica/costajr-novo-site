// Itens padrão do checklist de preventiva.
// Estrutura armazenada em manut_preventivas.checklist (jsonb):
//   { itens: [{ id, label, ok: boolean|null, obs: string }], observacoes_gerais, iniciado_em, concluido_em }
// Quando uma preventiva começa pela primeira vez, gera-se este template.
// Itens novos adicionados aqui no futuro NÃO aparecem em preventivas já iniciadas.

export type ChecklistItem = { id: string; label: string; categoria: string };

export const CHECKLIST_ITENS_PADRAO: ChecklistItem[] = [
  // Elétrica
  { id: "el_quadro",     categoria: "Elétrica", label: "Quadro de força sem aquecimento ou cheiro de queimado" },
  { id: "el_disjuntor",  categoria: "Elétrica", label: "Disjuntores identificados e funcionando" },
  { id: "el_tomadas",    categoria: "Elétrica", label: "Tomadas e interruptores em bom estado" },
  { id: "el_iluminacao", categoria: "Elétrica", label: "Iluminação funcionando (todas as lâmpadas)" },
  { id: "el_aterramento",categoria: "Elétrica", label: "Aterramento das tomadas verificado" },

  // Hidráulica
  { id: "hd_vasos",      categoria: "Hidráulica", label: "Vasos sanitários sem vazamento" },
  { id: "hd_torneiras",  categoria: "Hidráulica", label: "Pias e torneiras sem vazamento" },
  { id: "hd_ralos",      categoria: "Hidráulica", label: "Ralos desentupidos" },
  { id: "hd_caixa_agua", categoria: "Hidráulica", label: "Caixa d'água limpa e tampada" },
  { id: "hd_aquecedor",  categoria: "Hidráulica", label: "Aquecedor / chuveiro funcionando" },

  // Civil / estrutura
  { id: "cv_paredes",    categoria: "Civil", label: "Pintura e paredes em bom estado" },
  { id: "cv_pisos",      categoria: "Civil", label: "Pisos sem rachaduras ou levantamentos" },
  { id: "cv_forros",     categoria: "Civil", label: "Forros sem manchas ou infiltrações" },
  { id: "cv_portas",     categoria: "Civil", label: "Portas e janelas funcionando" },
  { id: "cv_calhas",     categoria: "Civil", label: "Telhado e calhas sem entupimento" },

  // Climatização
  { id: "cl_filtro",     categoria: "Climatização", label: "Filtros de ar-condicionado limpos" },
  { id: "cl_dreno",      categoria: "Climatização", label: "Dreno do ar-condicionado funcionando" },
  { id: "cl_termostato", categoria: "Climatização", label: "Termostato funcionando" },

  // Segurança
  { id: "sg_extintor",   categoria: "Segurança", label: "Extintores dentro da validade" },
  { id: "sg_emergencia", categoria: "Segurança", label: "Sinalização de emergência visível" },
];

export function checklistInicial() {
  return {
    itens: CHECKLIST_ITENS_PADRAO.map((it) => ({ ...it, ok: null as boolean | null, obs: "" })),
    observacoes_gerais: "",
    iniciado_em: new Date().toISOString(),
    concluido_em: null as string | null,
  };
}
