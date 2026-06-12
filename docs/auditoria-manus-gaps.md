# Auditoria Portal Manus × Portal Novo — Mapa de Lacunas e Plano de Execução

> Gerado em 12/06/2026 a partir do código-fonte completo do Manus (manus-export),
> do portal vivo (portalcjr.vip, perfis admin/coordenador/membro) e da documentação
> da sessão de desenvolvimento. Escopo: o que EXISTIA E FUNCIONAVA no Manus.
> (Financeiro/RH/Obras/Administrativo novos são tratados à parte — já construídos.)

## ✅ O que o portal novo JÁ COBRE (igual ou melhor que o Manus)
- Comunicados (Manus nem tinha), Base de Conhecimento (CRUD), Onboarding (trilha),
  Treinamentos (vídeos+PDFs), Documentos de integração, Fórum (tópicos/respostas)
- Membros: aprovar/rejeitar, cargo único, reset de senha com e-mail, criar
- Gestão Comercial kanban + indicadores (reconstruída 12/06 com dados migrados)
- TUDO de Ativos/Obras/RH/Financeiro/CRM novo (não existia no Manus)

## ❌ LACUNAS (existia no Manus, falta no novo) — por prioridade

### ONDA 1 — Gestão de membros completa + Notificações
1. **Múltiplos perfis por usuário** (ex: Patrícia = Administrativo+Operacional+Financeiro)
   — hoje só 1 cargo. Requer: portal_profiles.roles text[] + checagens nos endpoints.
2. **Permissão "Trabalhista"** por usuário (dar/remover) — controla acesso a conteúdo
   trabalhista no fórum/KB.
3. **Excluir usuário** e **editar nome** na tela de membros. [FEITO 12/06]
4. **Avatar do colaborador** (upload próprio + pelo admin).
5. **Notificações in-app** (sino no portal): pergunta respondida, novo comunicado,
   termo p/ assinar; marcar como lida/todas.

### ONDA 2 — JunIA (chat inteligente) + Perguntas pendentes
6. **Chat JunIA**: conversas persistentes, busca com scoring na KB, detecção de
   categoria por palavras-chave, filtro por perfil (matriz role×categoria),
   mensagens de redirecionamento (ex: financeiro → Vobi), resposta "não sei" →
   vira PENDENTE e notifica admins.
7. **Admin "Perguntas"**: fila de pendentes, responder (melhorando texto), opção
   "adicionar à KB", re-análise automática de outras pendentes, notificação ao autor.
8. **KB a partir de PDF/URL**: upload de documento extrai texto e alimenta a KB
   em blocos de 1500 caracteres.

### ONDA 3 — Gamificação + Dashboard pessoal + Relatórios
9. **Pontos**: vídeo assistido +10, PDF baixado +5, pergunta +1 (idempotente),
   exibidos no header do portal; **ranking top 20**; **relatório de conclusão de
   treinamentos** (% por colaborador) no admin.
10. **Dashboard pessoal** do colaborador (minhas perguntas, docs gerados,
    respondidas/pendentes) e **Perfil** (avatar, pontos, breakdown).
11. **Treinamentos hierárquicos**: Área → Subcategoria → Cliente (Santander/
    Carrefour) + marcar assistido/rever.

### ONDA 4 — Geradores de documentos técnicos
12. **Termo de Entrega Santander**: form (OS, Uniorg, datas) + lookup automático
    da planilha uniorg.xlsx (4670 unidades: nome+endereço) + PDF + histórico.
    Templates e planilha disponíveis em manus-export/server/.
13. **Ata de Reunião**: form completo (participantes, pauta, decisões,
    responsabilidades c/ prazo, observações) + **assinaturas desenhadas no canvas**
    + PDF timbrado + histórico. (Pode integrar com D4Sign quando token chegar.)

### ONDA 5 — Visual moderno (pedido explícito da Adriana)
14. **Modernizar o design**: o Manus usava shadcn/tailwind com cards em gradiente,
    hover com elevação, **dark mode**, ícones lucide, animações suaves. O portal
    novo está "travado/antigo". Refresh: tokens novos, gradientes da marca,
    micro-animações, dark mode opcional, sino de notificações, avatar no header.
15. Home do portal em módulos grandes coloridos (como o Manus) c/ pontos no header.

### Observações
- Gestão Técnica do Manus (estoque/equipamentos/efetivo da obra) → já coberto
  parcialmente por Ativos Patrimoniais + manut_estoque; avaliar se o time de obra
  precisa da visão própria no portal (decidir com Adriana).
- Matriz de permissões por perfil (rolePermissions) documentada no inventário —
  aplicar no JunIA e nos conteúdos.
