# Costa Junior Engenharia - Projeto costajr.com.br

> **Memoria consolidada em 11/05/2026.** Esta e a fonte de verdade
> do projeto. Atualize aqui quando algo importante mudar.

## Status do projeto

- **Site oficial em producao:** `costajr.com.br`
- **Stack:** Astro 5 + Vercel + Supabase + Mercado Pago + Resend
- **Repo:** `russodrica/costajr-novo-site`
- **Migracao concluida em maio/2026.** Manus, forum-cjr e Wix antigo: DESCONTINUADOS em definitivo.

---

## Indice geral

_Fonte original: `~/.claude/projects/.../memory/MEMORY.md`_

> **ATUALIZACAO 11/05/2026 (correcao da Adriana):**
> Migracao 100% concluida. O site oficial esta em producao em `costajr.com.br`
> (stack: Astro 5 + Vercel + Supabase + Mercado Pago + Resend).
> Portal Manus, forum-cjr e site Wix antigo: **DESCONTINUADOS em definitivo**.
> Nao existe mais "portal Manus" nem "site Wix" ativos. Nao tratar essas opcoes
> como ativas em futuras conversas - sao historico.

---
- [Adriana — perfil de usuário](user_role.md) — admin do Portal CJR, prefere opções objetivas em PT-BR, urgência em CAIXA ALTA
- [Portal CJR — projeto de intranet](portal_cjr_project.md) — reconstrução do app forum-cjr como Wix nativo no site "index"
- [Portal — bloqueio auth admin](portal_auth_blocker.md) — Adriana cai em "Aguardando aprovação" porque Wix retorna loginEmail=null; bypass adminkey em testes
- [Migração Wix → Astro/Vercel/Supabase](migracao_wix_para_astro.md) — decisão 2026-05-05 de migrar 100%; pasta nova `costajr-novo/` com 18 arquivos base já criados


---

## Historico do Portal CJR (referencia)

_Fonte original: `~/.claude/projects/.../memory/portal_cjr_project.md`_

> **ATUALIZACAO 11/05/2026 (correcao da Adriana):**
> Migracao 100% concluida. O site oficial esta em producao em `costajr.com.br`
> (stack: Astro 5 + Vercel + Supabase + Mercado Pago + Resend).
> Portal Manus, forum-cjr e site Wix antigo: **DESCONTINUADOS em definitivo**.
> Nao existe mais "portal Manus" nem "site Wix" ativos. Nao tratar essas opcoes
> como ativas em futuras conversas - sao historico.

---
---
name: Portal CJR — projeto de intranet
description: Reconstrução do Portal Costa Júnior (forum-cjr) como intranet nativa no site Wix "index". Substitui o app Node.js/React/tRPC/MySQL/S3 atual.
type: project
originSessionId: dfd3cd11-0578-452f-98cb-32037f43209d
---
**Decisão arquitetural (2026-05-04):** o Portal CJR está sendo reconstruído do zero como intranet nativa Wix, dentro do site "index" (ID: 56f326df-c9bf-4a63-9066-03767b43db09). Stack alvo: Wix Studio + Velo + Wix Data + Wix Members + Wix Media Manager. Substitui o app antigo em `D:/.../PORTALCJR/forum-cjr` (React + tRPC + Express + Drizzle/MySQL + S3).

**Why:** Adriana já paga hospedagem Wix. Opção descartada: self-host (mais barato mas exige domínio/manutenção separados). Wix nativo entrega "intranet dentro do site" sem custo extra.

**Módulos a portar:**
1. **Onboarding** — vídeo institucional + 8 PDFs (Cultura, Ética, LGPD, SST, Diversidade, Responsabilidade Socioambiental, Saúde/Segurança, Segurança do Trabalho)
2. **Documentos Técnicos** — gerador Termo de Entrega Santander (lookup 4670 Uniorgs); gerador Ata de Reunião com assinatura digital
3. **Fórum CJR / JunIA** — Q&A com base de conhecimento (37+ entradas), busca por palavra-chave, aprendizado pelo gestor. **NÃO usa LLM externo** — é só busca interna. Isso simplifica a porta para Velo.

**6 perfis de usuário:** admin, coordenador, financeiro, comercial, RH/DP, operacional.
**Permissões por categoria:** financeiro só vê financeiro; redirecionamentos automáticos (financeiro → Vobi; RH → DP; recrutamento → R&S).

**How to apply:** ao trabalhar neste projeto, lembre que o backend será 100% Velo (sem servidor próprio), o BD é Wix Data (NoSQL, não SQL), e a UI é construída no Wix Editor (não React do zero). Arquivos antigos em `forum-cjr/` servem como referência de regras de negócio, não de código portável.


---

## Migracao Wix -> Astro (referencia)

_Fonte original: `~/.claude/projects/.../memory/migracao_wix_para_astro.md`_

> **ATUALIZACAO 11/05/2026 (correcao da Adriana):**
> Migracao 100% concluida. O site oficial esta em producao em `costajr.com.br`
> (stack: Astro 5 + Vercel + Supabase + Mercado Pago + Resend).
> Portal Manus, forum-cjr e site Wix antigo: **DESCONTINUADOS em definitivo**.
> Nao existe mais "portal Manus" nem "site Wix" ativos. Nao tratar essas opcoes
> como ativas em futuras conversas - sao historico.

---
---
name: Migração Wix → Astro/Vercel/Supabase
description: Adriana decidiu abandonar Wix e migrar 100% do site + portais. Stack, motivos e estado das páginas.
type: project
originSessionId: dfd3cd11-0578-452f-98cb-32037f43209d
---
Em 2026-05-05 a Adriana aprovou migração 100% do site da Costa Júnior para fora do Wix.

**Stack escolhida:**
- Astro 5 (frontend SSR + API endpoints) hospedado na Vercel
- Supabase (PostgreSQL + Storage + Auth)
- Mercado Pago (já configurado: token APP_USR-7174475643508947-... cadastrado no Wix Secrets, será migrado pra .env Vercel)
- Resend (email transacional)
- Identidade visual: modernizar mantendo cores vermelho/preto e logo

**Why:** Wix era gargalo — iframe minúsculo no /portal-cliente, slug "blank-1" auto-gerado, cache de 15 min, currentMember.getMember() não funciona em http-functions, editor trava.

**How to apply:** A pasta nova é `D:\OneDrive - Costa Jr\T.I\3_Documentacao de Sistemas\PORTALCJR\costajr-novo\`. Repo GitHub: `russodrica/costajr-novo-site`. Vercel auto-deploya em cada push pra main. Domínio temporário: `costajr.com.br (em producao, antes ficava em costajr-novo-site.vercel.app)`.

**Páginas públicas criadas (commit 2b4f99c em 2026-05-05):** `/`, `/sobre`, `/servicos`, `/contato`, `/manutencao/contratar`, `/intranet`, `/artigos`, `/quero-ser-parceiro`, `/privacidade`, `/lgpd`. Todas usam `Base.astro` com tokens `--brand #C41E3A`, `--ink #2D2F36`, fontes Montserrat+Open Sans. Forms `/contato` e `/quero-ser-parceiro` usam mailto fallback (sem backend ainda). Form `/manutencao/contratar` chama `POST /api/manut/contratar` (existente). Planos do `/manutencao/contratar` estão como PLACEHOLDER (Essencial 890, Completo 1490, Premium 2290) — Adriana precisa revisar valores reais.

**Painel /admin CONCLUÍDO (2026-05-05):** 13 páginas + 20 APIs criadas com lint limpo. Acesso via cookie HttpOnly `admin_token`. Login usa `portal_profiles` (role admin/coordenador/etc + senha_hash). REQUER migration `db/migrations/001_portal_auth.sql` no Supabase para adicionar `senha_hash` à `portal_profiles` e inserir o primeiro admin. Seções: dashboard, clientes (+detalhe+reset senha), técnicos, chamados, preventivas, pagamentos, materiais, membros portal, precificação, leads, suporte, blog.

**Páginas dos portais ainda pendentes:** `/portal-cliente`, `/portal-tecnico` (links no `/intranet` apontam mas as rotas não existem).

**APIs já implementadas:** `/api/manut/contratar`, `/api/manut/cliente/login`, `/api/manut/mp_webhook` + todas `/api/admin/*`. Supabase 22 tabelas online.

**Antes de mexer no DNS Registro.br:** validar tudo no domínio temporário .vercel.app. Webhook MP precisa mudar de `/_functions/manut_mp_webhook` para `/api/manut/mp_webhook` quando trocar.

**Backup WP local corrompido:** ZIP `bkp costajr.zip` em D:\OneDrive\Marketing\3_Institucional\3_Site\Site\ está corrompido + arquivos extraídos no OneDrive ficam offline-only. Adriana foi orientada a usar scrape do costajr.com.br atual como fonte de conteúdo, OU clicar com botão direito na pasta extraída → "Sempre manter neste dispositivo".


---

## Bug de auth Wix (resolvido por descontinuacao)

_Fonte original: `~/.claude/projects/.../memory/portal_auth_blocker.md`_

> **ATUALIZACAO 11/05/2026 (correcao da Adriana):**
> Migracao 100% concluida. O site oficial esta em producao em `costajr.com.br`
> (stack: Astro 5 + Vercel + Supabase + Mercado Pago + Resend).
> Portal Manus, forum-cjr e site Wix antigo: **DESCONTINUADOS em definitivo**.
> Nao existe mais "portal Manus" nem "site Wix" ativos. Nao tratar essas opcoes
> como ativas em futuras conversas - sao historico.

---
---
name: Portal CJR — bloqueio do auth admin (RESOLVIDO mas aguardando cache)
description: Adriana cai em "Aguardando aprovação" / página vazia. Fix do bug ReferenceError publicado, aguardando cache do Wix Velo propagar.
type: project
originSessionId: dfd3cd11-0578-452f-98cb-32037f43209d
---
**Contexto:** /portal page mostra página vazia/aguardando aprovação para Adriana. /intranet funciona normal.

**Why:** Cadeia de bugs descoberta na sessão 2026-05-04:
1. `loginEmail` retorna `null` do `currentMember.getMember()` → fallback por email não funciona
2. memberId real produção da Adriana: `797aa7c9-205e-450c-81b1-4371aaf4273c` (atualizado no Portal_Profiles linha admin)
3. Bug ReferenceError: `member is not defined` no Portal Container.js — bypass `?adminkey=cjr-2026` deixou `authToken: member._id` referenciando variável fora de escopo. Fix aplicado: extraí `let authToken = ""` antes do if/else
4. Após publish do fix, Wix Velo cache ainda serve código antigo (5-15 min de propagação)

**How to apply na próxima sessão:**
1. Confirmar com Adriana se /portal funciona após o cache passar
2. Se ainda não, hard refresh + verificar console.log via Chrome MCP read_console_messages: deve estar limpo (sem ReferenceError)
3. Validar painel admin completo carrega: Início, Onboarding, Documentos Técnicos, Fórum/JunIA, Painel Admin
4. Comparar com original https://portalcjr.vip/admin/dashboard pra validar feature parity

**Estado em fim de sessão 2026-05-04:**
- /intranet online com hub de 3 cards (Acesso CJR + 2 placeholders "Em breve")
- Botão "Intranet" no menu principal Wix
- Botão "Sair / Trocar conta" na tela de aguardando do SPA
- 9 usuários legacy migrados em Portal_Profiles via seed_legacy_users (token cjr-migration-2026-05-04)
- Bypass `/portal?adminkey=cjr-2026` (escape hatch admin enquanto auth não funciona)
- Linha admin row 11→10 do CMS: memberId=797aa7c9-205e-450c-81b1-4371aaf4273c, email=adriana@costajr.com.br, role=admin, status=approved
- Fix bug member-not-defined publicado (aguardando cache Wix Velo)

**Pendências:**
- Reordenar menu: "Intranet" pra ficar ao lado de "Loja" (manual no editor: Páginas e menu → arrasta)
- Construir Portal Cliente e Portal Parceiro (placeholder "Em breve" hoje)
- Largura HTML Component da /intranet pra mostrar 3 cards lado a lado


---

## Sobre a usuaria Adriana

_Fonte original: `~/.claude/projects/.../memory/user_role.md`_

> **ATUALIZACAO 11/05/2026 (correcao da Adriana):**
> Migracao 100% concluida. O site oficial esta em producao em `costajr.com.br`
> (stack: Astro 5 + Vercel + Supabase + Mercado Pago + Resend).
> Portal Manus, forum-cjr e site Wix antigo: **DESCONTINUADOS em definitivo**.
> Nao existe mais "portal Manus" nem "site Wix" ativos. Nao tratar essas opcoes
> como ativas em futuras conversas - sao historico.

---
---
name: Adriana — perfil de usuário
description: Adriana Russo, admin geral do Portal CJR (Costa Júnior Engenharia). Não é desenvolvedora full-stack — pensa em produto e operação, prefere caminhos curtos e visíveis.
type: user
originSessionId: dfd3cd11-0578-452f-98cb-32037f43209d
---
Adriana Russo (adriana@costajr.com.br) é admin/dona do Portal CJR e do site Wix da Costa Júnior Engenharia. Toma decisões de produto da intranet (perfis, conteúdo, fluxo de aprovação). Tem acesso ao Wix Studio, conta Vobi, conta Mercado Livre (TrazPraCa Club), conta Monday, e à base institucional da empresa.

Não é desenvolvedora — escreve em português, com pressa, em maiúsculas quando algo é importante. Prefere decisões objetivas ("Opção A, B ou C") a explicações técnicas longas. Quer ver resultado online o quanto antes.

Já está usando Claude Code com vários MCPs configurados (Wix, Vobi, Monday, Microsoft 365, Outlook, Gmail, Canva, computer-use). Indica familiaridade com automação operacional, não com programação.

**How to apply:** quando algo for ambíguo, ofereça opções numeradas em vez de pedir especificação técnica. Explique custos e tempo, não bibliotecas. Mostre o que vai aparecer na tela. Use português. Quando ela escreve em CAIXA ALTA, é prioridade — trate como tal.


---

## Atualizacao 11/06/2026 — Melhorias do PDF + modulos de gestao empresarial

**Correcoes aplicadas (PDF de melhorias):**
- Membros/Materiais/Alt. Preco Estoque: filtro padrao escondia registros — agora padrao "todos" com contadores
- admin/leads usava coluna inexistente `status_crm` — corrigido para `etapa`
- Dashboard buscava leads na tabela errada (`leads` em vez de `manut_leads`)
- "Analytics" renomeado para "Analise do Site"

**Causa raiz do portal colaborador vazio:** a migration `004_portal_colaborador.sql`
nunca tinha sido rodada em producao. Aplicada em 11/06/2026 junto com as novas
(020-023) via SQL Editor. **Migrations 004, 020, 021, 022, 023 = RODADAS em producao.**

**Conteudo do Manus importado** via `scripts/importar-conteudo-manus.mjs` (idempotente):
36 Q&As na base de conhecimento, video institucional + 8 PDFs de politicas
(onboarding + documentos, re-hospedados no bucket `portal` do Supabase Storage),
3 treinamentos Santander. ATENCAO: os 2 videos de treinamento grandes (Fusao
Santander 428MB, Liberacao de Acesso 53MB) continuam no CDN do Manus
(files.manuscdn.com) por excederem o limite de upload do Supabase — se o CDN
sair do ar, re-hospedar (ex: YouTube nao listado) e atualizar `url_video`.

**Modulos novos (menu "Empresa" no admin):**
- `/admin/ativos` + `/admin/ativos/[id]` — Ativos Patrimoniais: cadastro por categoria
  (telefonia/informatica/equip. obra/EPI/veiculo/mobiliario) com campos especificos,
  movimentacoes auditaveis (tabela `ativos_movimentos`, nunca apagar), termo de
  responsabilidade gerado na entrega com aceite digital no portal (data/hora/IP),
  manutencoes, ocorrencias, baixa/descarte. API central: `/api/admin/ativos/[id]/movimentar`
- `/admin/obras` — Obras & Projetos (ativos podem ser transferidos para obras)
- `/admin/rh` — RH: ficha do colaborador, ferias/ausencias, documentos com validade, aniversariantes
- `/admin/financeiro` — contas a pagar/receber (`fin_lancamentos`), categorias, fluxo de
  caixa consolidado com `manut_pagamentos`
- `/admin/comercial` — CRM kanban sobre `manut_leads.etapa` com drag & drop, propostas
  (`com_propostas`), metas mensais (`com_metas`)
- Portal do Colaborador: `/portal/meus-equipamentos` (equipamentos + aceite de termos)

**Dashboard admin** reformulado: pendencias criticas, KPIs com comparativo mensal,
graficos CSS puros (sem lib), funil comercial. Layout admin com menu agrupado colapsavel.

**Migracao Vobi (11/06/2026):** dados financeiros da Vobi importados para o modulo
Financeiro via `scripts/migrar-vobi.mjs` + migration 024 (colunas `vobi_id`, RODADA).
Importados: 250 categorias, 226 projetos→obras, 24.161 lancamentos (1.941 receitas,
22.220 despesas). Fonte: export JSON gerado no navegador logado em app.vobi.com.br
(o token da sessao funciona na API v2; as credenciais system UUID/SECRET da skill
estavam revogadas). Para re-sincronizar: gerar novo export pelo navegador e rodar
`node scripts/migrar-vobi.mjs <arquivo.json>` — e idempotente (upsert por vobi_id).
API Vobi: docs em https://api.vobi.com.br/v2/docs/ (spec completo extraido em
D:/temp/vobi_openapi.json). Credenciais system validas no .env (VOBI_UUID/VOBI_SECRET).

**OBJETIVO ESTRATEGICO (decisao da Adriana em 11/06/2026): ELIMINAR a Vobi e ter
plataforma propria.** Mapeamento de uso real da Vobi (via API): Financeiro 26k
lancamentos (pesado), orcamentos de obra refurbish-items 500+, biblioteca de itens
500+, 28 templates, tarefas 500+, anotacoes 480, diario de obra 7. NAO usam:
pedidos de compra (0), cotacoes (0), medicoes (0), estoque (0), propostas (1).
Cadastros: 2.542 fornecedores + 453 clientes.

Plano de substituicao por fases (a executar):
- Fase A: Cadastros (fornecedores/clientes como entidades) + Financeiro operacional
  (contas bancarias, anexos, recorrencia, DRE, centro de custo) + importar
  fornecedores/clientes completos da Vobi
- Fase B: Orcamentos de obra (biblioteca de composicoes, orcamento por obra com BDI,
  proposta em PDF) + importar biblioteca e orcamentos da Vobi
- Fase C: Planejamento (cronograma/tarefas por obra, diario de obra, anotacoes)
- Fase D: rodar em paralelo, sincronizacao final, cancelar assinatura Vobi

**Videos de treinamento re-hospedados no YouTube do canal CJR (11/06/2026, nao
listados):** Fusao Santander = youtu.be/cVrim8iT4YM, Liberacao de Acesso Santander
= youtu.be/INC3RDHqpEk. URLs atualizadas em portal_treinamentos_videos. O player
do portal converte links do YouTube em embed automaticamente.

## Convencoes desta pasta para o Claude Code

- Sempre que iniciar uma sessao nesta pasta, leia este CLAUDE.md primeiro.
- Quando o usuario disser "atualize a memoria", edite as secoes deste arquivo.
- Quando descobrir algo novo importante (decisao de arquitetura, padrao, blocker), proponha adicionar aqui.
- Nao referencie mais `forum-cjr`, `portal Manus` ou `Wix` como opcoes ativas - sao historico.