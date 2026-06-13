// Gera o MAPA COMPLETO do Portal Costa Júnior em Excel (.xlsx).
import ExcelJS from "exceljs";

const wb = new ExcelJS.Workbook();
wb.creator = "Portal Costa Júnior";
wb.created = new Date();

const BRAND = "FFC41E3A", INK = "FF2D2F36", CINZA = "FFF3F4F6";
const VERDE = "FF16A34A", AMARELO = "FFD97706", VERMELHO = "FFB91C1C", AZUL = "FF1D4ED8";

function corStatus(s) {
  const t = String(s).toLowerCase();
  if (t.includes("pronto") || t.includes("ok") || t.includes("produção")) return VERDE;
  if (t.includes("pendente") || t.includes("aguard") || t.includes("você")) return AMARELO;
  if (t.includes("futuro") || t.includes("fase") || t.includes("planejado")) return AZUL;
  return INK;
}

function aba(nome, colunas, linhas, opts = {}) {
  const ws = wb.addWorksheet(nome, { views: [{ state: "frozen", ySplit: opts.titulo ? 3 : 1 }] });
  let r = 1;
  if (opts.titulo) {
    ws.mergeCells(1, 1, 1, colunas.length);
    const c = ws.getCell(1, 1);
    c.value = opts.titulo;
    c.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND } };
    c.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    ws.getRow(1).height = 26;
    if (opts.sub) {
      ws.mergeCells(2, 1, 2, colunas.length);
      const s = ws.getCell(2, 1);
      s.value = opts.sub;
      s.font = { italic: true, size: 10, color: { argb: "FF6B7280" } };
      s.alignment = { indent: 1 };
    }
    r = 3;
  }
  // cabeçalho
  const head = ws.getRow(r);
  colunas.forEach((col, i) => {
    const cell = head.getCell(i + 1);
    cell.value = col.t;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
    cell.alignment = { vertical: "middle", horizontal: col.align || "left", wrapText: true, indent: 1 };
    ws.getColumn(i + 1).width = col.w || 24;
  });
  head.height = 22;
  // linhas
  linhas.forEach((linha, idx) => {
    const row = ws.getRow(r + 1 + idx);
    colunas.forEach((col, i) => {
      const cell = row.getCell(i + 1);
      cell.value = linha[col.k] ?? "";
      cell.alignment = { vertical: "top", horizontal: col.align || "left", wrapText: true, indent: 1 };
      cell.font = { size: 10, color: { argb: INK } };
      if (idx % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CINZA } };
      if (col.k === "status") cell.font = { size: 10, bold: true, color: { argb: corStatus(linha.status) } };
      if (col.k === "n" || col.align === "right") cell.numFmt = typeof linha[col.k] === "number" ? "#,##0" : undefined;
    });
    row.height = Math.max(16, Math.ceil((String(linha[colunas[1].k] || "").length) / 55) * 14);
  });
  return ws;
}

// ───────────────────────── 1. RESUMO / MÓDULOS ─────────────────────────
aba("Resumo",
  [
    { t: "Módulo", k: "mod", w: 26 },
    { t: "O que faz", k: "faz", w: 60 },
    { t: "Onde acessar", k: "onde", w: 26 },
    { t: "Status", k: "status", w: 20 },
  ],
  [
    { mod: "Site público", faz: "Páginas institucionais: home, sobre, serviços, contato, contratar manutenção, seja parceiro, LGPD.", onde: "costajr.com.br", status: "Pronto / produção" },
    { mod: "Painel Admin", faz: "Central de gestão da empresa (36 telas). Acesso por login com cookie seguro.", onde: "/admin", status: "Pronto / produção" },
    { mod: "Portal do Colaborador", faz: "Área interna do funcionário: onboarding, treinamentos, JunIA, documentos, meus equipamentos.", onde: "/portal", status: "Pronto / produção" },
    { mod: "Membros & Permissões", faz: "Cadastro de usuários, múltiplos perfis, flag trabalhista, central de permissões por perfil.", onde: "/admin/membros, /admin/permissoes", status: "Pronto / produção" },
    { mod: "Comercial / CRM", faz: "Funil kanban de leads, propostas, metas, interações e ranking de vendedores.", onde: "/admin/comercial, /portal/gestao-comercial", status: "Pronto / produção" },
    { mod: "JunIA (assistente)", faz: "Chat inteligente que responde da base de conhecimento; o que não sabe vira pendência pro gestor responder.", onde: "/portal/junia, /admin/perguntas", status: "Pronto / produção" },
    { mod: "Gestão de Conteúdo", faz: "Comunicados, base de conhecimento, onboarding e treinamentos — com upload de arquivos e import de PDF.", onde: "/admin/portal-*", status: "Pronto / produção" },
    { mod: "Onboarding", faz: "Integração do novo colaborador: vídeo + PDFs embutidos, marcar concluído, progresso por pessoa.", onde: "/portal/onboarding", status: "Pronto / produção" },
    { mod: "Gestão de Obras", faz: "Obras com tarefas/cronograma, anotações, diário de obra (RDO), custo orçado x realizado.", onde: "/admin/obras", status: "Pronto / produção" },
    { mod: "Gestão de Ativos", faz: "Patrimônio: equipamentos, EPIs, veículos, telefonia. Entrega com termo, fotos, etiqueta QR, cofre de NF, manutenção preventiva.", onde: "/admin/ativos", status: "Pronto / produção" },
    { mod: "RH / DP", faz: "Colaboradores, documentos com validade, alertas de ASO/CNH vencendo, férias, admissão digital, aniversariantes.", onde: "/admin/rh", status: "Pronto / produção" },
    { mod: "Financeiro", faz: "Contas a pagar/receber, fluxo de caixa (agregado no banco), DRE, conciliação OFX. 25 mil lançamentos da Vobi.", onde: "/admin/financeiro", status: "Pronto / produção" },
    { mod: "Manutenção (clientes)", faz: "Contratos de manutenção: clientes, chamados, técnicos, preventivas, pagamentos (Mercado Pago), materiais.", onde: "/admin (vários)", status: "Pronto / produção" },
    { mod: "Orçamentos de obra", faz: "Base mestre de serviços, parâmetros BDI, montador de orçamento (plataforma inteligente).", onde: "/admin/orcamentos", status: "Em desenvolvimento" },
    { mod: "Assinatura digital (D4Sign)", faz: "Envio de termos/contratos para assinatura com validade jurídica. Seletor de cofre.", onde: "/admin/assinaturas", status: "Pendente: chaves na Vercel (você)" },
  ],
  { titulo: "MAPA DO PORTAL COSTA JÚNIOR — Visão geral dos módulos", sub: "Gerado automaticamente · stack: Astro + Supabase + Vercel · costajr.com.br" }
);

// ───────────────────────── 2. PAINEL ADMIN ─────────────────────────
const adminPaginas = [
  ["Início / Dashboard", "/admin", "KPIs, pendências críticas, funil comercial, gráficos"],
  ["Membros", "/admin/membros", "Usuários do portal: perfis, trabalhista, avatar, reset senha, excluir"],
  ["Permissões", "/admin/permissoes", "Matriz: o que cada perfil pode acessar"],
  ["Perguntas (JunIA)", "/admin/perguntas", "Fila de dúvidas que a JunIA não soube; responder + virar conhecimento"],
  ["Base de Conhecimento", "/admin/portal-kb", "Perguntas e respostas da JunIA; importar de PDF/URL"],
  ["Comunicados", "/admin/portal-comunicados", "Avisos para os colaboradores (notifica no sino)"],
  ["Onboarding", "/admin/portal-onboarding", "Etapas de integração + progresso por colaborador"],
  ["Treinamentos", "/admin/portal-treinamentos", "Vídeos e PDFs de treinamento por setor"],
  ["Comercial / CRM", "/admin/comercial", "Funil de leads, propostas, metas"],
  ["Leads", "/admin/leads", "Lista de oportunidades comerciais"],
  ["Obras", "/admin/obras", "Obras com tarefas, anotações, RDO, custo"],
  ["Ativos", "/admin/ativos", "Patrimônio; exportar/importar planilha; etiqueta QR"],
  ["RH", "/admin/rh", "Colaboradores, documentos, alertas, férias, admissão"],
  ["Financeiro", "/admin/financeiro", "Contas, fluxo de caixa, DRE"],
  ["Conciliação bancária", "/admin/fin-conciliacao", "Importar extrato OFX e conciliar"],
  ["Orçamentos", "/admin/orcamentos", "Montador de orçamento de obra (em desenvolvimento)"],
  ["Clientes (manutenção)", "/admin/clientes", "Clientes dos contratos de manutenção"],
  ["Chamados", "/admin/chamados", "Ordens de serviço da manutenção"],
  ["Técnicos", "/admin/tecnicos", "Equipe técnica de campo"],
  ["Preventivas", "/admin/preventivas", "Manutenções preventivas programadas"],
  ["Pagamentos", "/admin/pagamentos", "Cobranças (Mercado Pago) e régua de cobrança"],
  ["Materiais", "/admin/materiais", "Estoque e reposição de materiais"],
  ["Representantes", "/admin/representantes", "Rede de representantes e descontos"],
  ["Precificação / Cupons", "/admin/precificacao, /admin/cupons", "Planos, preços e cupons"],
  ["Assinaturas (D4Sign)", "/admin/assinaturas", "Documentos em assinatura digital"],
  ["Análise do Site", "/admin/analytics", "Visitas e métricas do site"],
  ["Blog / Suporte", "/admin/blog, /admin/suporte", "Conteúdo do blog e tickets de suporte"],
];
aba("Painel Admin",
  [{ t: "Tela", k: "tela", w: 26 }, { t: "Endereço", k: "url", w: 34 }, { t: "Para que serve", k: "desc", w: 60 }],
  adminPaginas.map(([tela, url, desc]) => ({ tela, url, desc })),
  { titulo: "PAINEL ADMIN — 36 telas de gestão", sub: "Acesso restrito por login (cookie seguro)" }
);

// ───────────────────────── 3. PORTAL COLABORADOR ─────────────────────────
const portalPaginas = [
  ["Início", "/portal", "Hub com módulos, comunicados e busca na base de conhecimento"],
  ["JunIA", "/portal/junia", "Assistente que tira dúvidas (com a mascote)"],
  ["Onboarding", "/portal/onboarding", "Integração: vídeo, políticas em PDF, marcar concluído"],
  ["Treinamentos", "/portal/treinamentos", "Vídeos e materiais do setor"],
  ["Fórum", "/portal/forum", "Troca de ideias da equipe"],
  ["Documentos", "/portal/documentos", "Manuais e procedimentos técnicos"],
  ["Gestão Comercial", "/portal/gestao-comercial", "Kanban de leads (perfis comerciais)"],
  ["Gestão Manutenção", "/portal/gestao-manutencao", "Clientes/chamados (perfis operacionais)"],
  ["Meus Equipamentos", "/portal/meus-equipamentos", "Equipamentos sob responsabilidade + aceite de termo"],
  ["Minha Conta", "/portal/minha-conta", "Editar nome e trocar senha"],
];
aba("Portal Colaborador",
  [{ t: "Tela", k: "tela", w: 24 }, { t: "Endereço", k: "url", w: 32 }, { t: "Para que serve", k: "desc", w: 58 }],
  portalPaginas.map(([tela, url, desc]) => ({ tela, url, desc })),
  { titulo: "PORTAL DO COLABORADOR — 12 telas", sub: "Menu filtrado pela permissão de cada perfil" }
);

// ───────────────────────── 4. BANCO DE DADOS ─────────────────────────
const tabelas = [
  ["portal_profiles", "Usuários do portal (admin/colaborador)", 11],
  ["portal_kb", "Base de conhecimento da JunIA", 36],
  ["portal_notificacoes", "Notificações in-app (sino)", 11],
  ["portal_onboarding_steps", "Etapas de onboarding", 12],
  ["portal_treinamentos_videos", "Vídeos de treinamento", 2],
  ["manut_clientes", "Clientes de manutenção", 1],
  ["manut_chamados", "Chamados / ordens de serviço", 2],
  ["manut_pagamentos", "Cobranças de manutenção", 1],
  ["manut_leads", "Leads comerciais", 59],
  ["obras", "Obras e projetos", 226],
  ["obras_tarefas", "Tarefas/cronograma de obra (Vobi)", 278],
  ["obras_anotacoes", "Anotações de obra (Vobi)", 105],
  ["ativos", "Patrimônio (equipamentos, EPIs, veículos)", 0],
  ["ativos_movimentos", "Histórico imutável de ativos", 0],
  ["ativos_termos", "Termos de responsabilidade", 0],
  ["rh_colaboradores", "Colaboradores (Monday)", 96],
  ["rh_documentos", "Documentos do colaborador (Monday)", 305],
  ["rh_admissoes", "Admissões digitais", 0],
  ["fin_lancamentos", "Lançamentos financeiros (Vobi)", 25437],
  ["fin_categorias", "Categorias financeiras", 262],
];
aba("Banco de Dados",
  [{ t: "Tabela", k: "tab", w: 30 }, { t: "O que guarda", k: "desc", w: 48 }, { t: "Registros hoje", k: "n", w: 18, align: "right" }],
  tabelas.map(([tab, desc, n]) => ({ tab, desc, n })),
  { titulo: "BANCO DE DADOS (Supabase) — principais tabelas", sub: "Contagem no momento da geração. RLS ativo; acesso só pelo backend." }
);

// ───────────────────────── 5. INTEGRAÇÕES ─────────────────────────
aba("Integrações",
  [{ t: "Serviço", k: "s", w: 22 }, { t: "Para que", k: "p", w: 50 }, { t: "Status", k: "status", w: 30 }],
  [
    { s: "Supabase", p: "Banco de dados, arquivos (Storage) e autenticação", status: "Pronto / produção" },
    { s: "Vercel", p: "Hospedagem do site/portal (deploy automático a cada alteração)", status: "Pronto / produção" },
    { s: "Mercado Pago", p: "Cobrança e pagamento dos contratos de manutenção", status: "Pronto / produção" },
    { s: "Resend", p: "Envio de e-mails (senhas, cobranças, alertas de RH)", status: "Pronto / produção" },
    { s: "Vobi (saída)", p: "Sistema financeiro antigo — dados importados (25k lançamentos, obras, tarefas)", status: "Em substituição (Fases A-D)" },
    { s: "Monday (saída)", p: "RH importado: 96 colaboradores + 305 documentos", status: "Importado (board Docs Empresa pendente)" },
    { s: "D4Sign", p: "Assinatura digital de termos e contratos", status: "Pendente: colar chaves na Vercel (você)" },
    { s: "YouTube (CJR)", p: "Hospeda 2 vídeos grandes de treinamento Santander", status: "Pronto / produção" },
  ],
  { titulo: "INTEGRAÇÕES — serviços externos", sub: "" }
);

// ───────────────────────── 6. PENDÊNCIAS / PRÓXIMOS PASSOS ─────────────────────────
aba("Pendências",
  [{ t: "Item", k: "i", w: 34 }, { t: "Detalhe", k: "d", w: 56 }, { t: "Quem", k: "q", w: 18 }, { t: "Status", k: "status", w: 18 }],
  [
    { i: "D4Sign — chaves na Vercel", d: "Colar D4SIGN_TOKEN e D4SIGN_CRYPT_KEY nas variáveis de ambiente da Vercel (produção) para ativar a assinatura.", q: "Adriana", status: "Pendente" },
    { i: "Modelos de contrato", d: "Passar o caminho dos modelos (empreiteiros/PJ) para integrar à D4Sign.", q: "Adriana", status: "Pendente" },
    { i: "Vobi Fase A — Cadastros + Financeiro", d: "Contas bancárias, fornecedores/clientes completos, recorrência, centro de custo.", q: "Claude", status: "Fase futura" },
    { i: "Vobi Fase B — Orçamentos de obra", d: "Biblioteca de composições, orçamento por obra com BDI, proposta em PDF.", q: "Claude", status: "Fase futura" },
    { i: "Vobi Fase C — Planejamento", d: "Cronograma/tarefas e diário já iniciados; ampliar e migrar o resto.", q: "Claude", status: "Em andamento" },
    { i: "Recorrência automática (financeiro)", d: "Gerar lançamentos fixos automaticamente todo mês.", q: "Claude", status: "Fase futura" },
    { i: "Monday — board Documentos Empresa", d: "Importar o board 'DOCUMENTOS EMPRESA' (6803034312) ainda pendente.", q: "Claude", status: "Fase futura" },
    { i: "Cron de e-mail RH (vencimentos)", d: "Registrar no vercel.json (Hobby limita a 2 crons — confirmar plano).", q: "Adriana", status: "Pendente" },
    { i: "Extras RH (opcionais)", d: "Saldo de férias, foto do colaborador, autoatendimento — aguardando sua decisão.", q: "Adriana", status: "Pendente" },
  ],
  { titulo: "PENDÊNCIAS E PRÓXIMOS PASSOS", sub: "O que falta e de quem depende" }
);

const destino = "D:/OneDrive - Costa Jr/T.I/3_Documentacao de Sistemas/MAPA_PORTAL_CJR.xlsx";
await wb.xlsx.writeFile(destino);
console.log("Gerado:", destino);
