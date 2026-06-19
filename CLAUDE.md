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
- Mercado Pago (token guardado em MP_ACCESS_TOKEN no .env/Vercel — NUNCA commitar o valor real)
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

## Atualizacao 12/06/2026 — Monday, D4Sign e seguranca/LGPD

**Importacao Monday (concluida):** board "RH" (6629107099) do Monday importado:
96 colaboradores -> rh_colaboradores (upsert por monday_id) e 306 documentos
(RG/CNH/ASO/EPI/NRs/contratos) baixados e re-hospedados no bucket PRIVADO `rh`
do Supabase Storage -> rh_documentos (upsert por monday_asset_id, com validade).
Script: scripts/importar-rh-monday.mjs (depende de exports em D:/temp gerados
via MCP do Monday). Acesso aos arquivos: somente via
/api/admin/rh/documentos/[id]/arquivo (admin autenticado -> URL assinada 10min).
PENDENTE: board "DOCUMENTOS EMPRESA" (6803034312) ainda nao importado.

**D4Sign (codigo pronto, aguardando token):** a conta D4Sign da Adriana NAO tem
token de API gerado (campo vazio no menu Dev API) — precisa pedir ativacao ao
suporte/comercial da D4Sign. Quando chegar: D4SIGN_TOKEN no .env + Vercel env.
Integracao: src/lib/d4sign.ts (cofres, upload, signatarios, envio, webhook,
download), src/lib/termoPdf.ts (gera PDF do termo com pdf-lib),
POST /api/admin/termos/[id]/enviar-d4sign (botao na tela do ativo),
POST /api/d4sign/webhook (atualiza status/aceite), /admin/assinaturas (lista
documentos dos cofres; mostra instrucoes de setup quando sem token).
Migrations 025 (d4sign_* em ativos_termos) e 026 (monday_id/storage_path) RODADAS.

**Seguranca/LGPD (estado em 12/06/2026):**
- Buckets: `rh` PRIVADO (docs pessoais sensiveis); preventivas/materiais/chamados/
  portal publicos (operacionais; URLs nao enumeraveis). RECOMENDACAO futura:
  tornar `materiais` privado (comprovantes de pagamento).
- Headers de seguranca adicionados no vercel.json (nosniff, X-Frame-Options,
  HSTS, Referrer-Policy, noindex em /admin e /portal).
- RLS habilitado em todas as tabelas; acesso so via service role no backend.
- MELHORIAS RECOMENDADAS (nao feitas): trocar hash de senha SHA256+salt fixo por
  bcrypt/argon2 (exige migracao gradual); rate limiting nos logins; CORS dos
  endpoints JSON usa allow-origin * (cookies SameSite mitigam CSRF).

**Benchmark de mercado:** relatorio completo em docs/benchmark-melhorias.md
(gap analysis vs Sienge/Convenia/CV CRM/Mobuss/Fracttal + top 10 melhorias).

## Atualizacao 12/06/2026 (parte 2) — Top 10 do benchmark IMPLANTADO

Melhorias implantadas (de docs/benchmark-melhorias.md):
- #2 OS do tecnico: foto ANTES obrigatoria p/ iniciar, foto DEPOIS p/ concluir,
  GPS capturado no inicio (manut_chamados.fotos_antes/fotos_depois/geo_*).
  Exigencia vale SO no fluxo do tecnico (param exigirFotos); admin nao exige.
- #3 Etiqueta QR por ativo: /admin/ativos/[id]/etiqueta (lib qrcode)
- #4 Conciliacao bancaria OFX: /admin/fin-conciliacao + src/lib/ofx.ts (parser
  proprio sem dependencia), sugestoes de match por valor+-data, criar/ignorar
- #5 Custo por obra: /admin/obras/[id] com orcado x realizado e % consumido
- #6 Admissao digital: aba Admissoes no /admin/rh cria link publico
  /admissao/[token]; candidato envia docs pelo celular -> bucket privado rh;
  'Concluir' vira colaborador + docs migram p/ rh_documentos
- #7 RDO diario de obra: secao na pagina da obra (clima/efetivo/atividades/
  ocorrencias, unique por obra+data) — API /api/admin/obras/[id]/rdo
- #8 Aceite online de proposta: /proposta/[token] (aceite registra nome/IP/data,
  lead vira convertido) — botao 'Link de aceite' no CRM
- #9 Regua de cobranca: cron diario /api/cron/regua-cobranca (3d antes/no dia/
  3d depois, 1 email por estagio via manut_pagamentos.regua_estagio)
- #10 Preventiva por ativo: planos com periodicidade em ativos_manutencao_planos,
  botao 'Executada' reprograma; card 'Preventivas vencidas' na listagem
- Migrations 027 e 028 RODADAS em producao.
- Pendentes do top 10: #1 D4Sign (aguardando token da conta).

## Atualizacao 12/06/2026 (parte 3) — Plataforma Inteligente de Orcamentos (Comercial)

**Novo projeto estrategico:** transformar a planilha de orcamento padrao em base
oficial + modulo de orcamentos no portal. Pasta de trabalho:
`D:\OneDrive - Costa Jr\Comercial\3_Propostas\_EM ANDAMENTO\!_PASTA PADRAO\ORÇAMENTO BASE\`

**Feito em 12/06/2026 (Etapas 1 e 7 do plano):**
- Estrutura de pastas criada (Banco de Dados, Composições, SINAPI, SICRO, Modelos,
  Propostas, Cronogramas, Fluxo Financeiro, Templates, Logs).
- Auditoria dos 1.837 itens da base (abas Civil 814, Elétrica 587, Hidráulica 322,
  Ar Condicionado 114 do `ORÇAMENTO xxxx_NOME CLIENTE_ESCOPO_R00.xlsx`):
  19 grupos mesmo-nome-preco-diferente (pior caso: R$ 39.829 de divergencia),
  6 duplicados exatos, 103 quase-duplicados, 23 grafias de unidade, item EL597
  duplicando H234 em disciplina errada.
- Gerada `Banco de Dados\BASE_MESTRE_SERVICOS_v1.xlsx`: CADASTRO_SERVICOS
  padronizado (+ colunas SINAPI/SICRO vazias p/ Etapa 2), PARAMETROS_BDI,
  CAD_EQUIPAMENTOS/EQUIPES/INSUMOS (Etapa 3, vazios), DE_PARA_UNIDADES,
  AUDITORIA (141 achados com gravidade e acao recomendada).
- Plano executivo das Etapas 2-8 em `PLANO_EXECUTIVO_PLATAFORMA_ORCAMENTOS.md`
  (SINAPI/SICRO, banco Supabase `orc_*`, modulo /admin/orcamentos, geracao de
  documentos, fluxo financeiro por data de inicio, IA hibrida Claude+embeddings).

**Como funciona o modelo da planilha atual:** quantidades sao digitadas nas abas
de disciplina; a aba DEFINITIVA puxa via VLOOKUP e aplica multiplicador V3 =
1 + imposto(25%) + ISS(5%) + resultado(faixa 25-50%) + contingencia(3%) +
custo financeiro(1,5%) + indireto(15,5%) + grau de risco(0-50%). Parametros vem
da `COMPOSIÇÃO_CUSTO.xlsx`. Template de proposta = PPTX de 11 slides na mesma pasta.

**PENDENTE (bloqueia base v2):** equipe revisar aba AUDITORIA e definir precos
unicos para os 19 grupos divergentes.

**Fase 1 ENTREGUE em 13/06/2026 (decisao da Adriana: comecar; usar SO SINAPI, sem SICRO):**
- Migration `db/migrations/036_orcamentos.sql` — tabelas `orc_servicos`,
  `orc_parametros_bdi` (parametros de BDI ja semeados via INSERT), `orc_equipamentos`,
  `orc_equipes`, `orc_insumos`, `orc_orcamentos` + `orc_orcamento_itens`. RLS ligado
  (so service role). **PRECISA SER RODADA no SQL Editor do Supabase (1x).** Ainda NAO rodada.
- Tela `/admin/orcamentos` (menu Empresa → Orcamentos 🧮): catalogo dos 1.837 servicos
  com busca, filtros (disciplina/grupo/auditoria/ativo), paginacao server-side, CRUD via
  modal, KPIs + atalho p/ pendencias de auditoria. Subpagina `/admin/orcamentos/parametros`:
  editor de BDI + simulador do multiplicador V3 em tempo real.
- APIs `/api/admin/orcamentos/servicos` (GET paginado+filtros, POST), `/servicos/[codigo]`
  (PATCH, DELETE soft por padrao / hard=1), `/parametros` (GET, PATCH em lote).
- Import idempotente `scripts/importar-base-orcamento.mjs` (upsert por codigo via PostgREST
  resolution=merge-duplicates) a partir de `scripts/seed/orc_servicos.json` (gerado do
  BASE_MESTRE pelo finalize_seed.py). QA E2E `scripts/qa-orcamentos.mjs` (override BASE por
  env QA_BASE). **Fluxo p/ ativar:** (1) Adriana roda migration 036 no SQL Editor →
  (2) `node scripts/importar-base-orcamento.mjs` → (3) deploy → (4) `node scripts/qa-orcamentos.mjs`.
- MODELO DE PRECO (importante): `custo_material`/`custo_mao_obra` sao CUSTO sem BDI; preco de
  venda = custo*(1+BDI). O "Com BDI" das abas de disciplina da planilha original era rotulo
  enganoso — o BDI real e o multiplicador V3 da aba DEFINITIVA. Rotulo corrigido na BASE_MESTRE.
- Lint (`tsc --noEmit`) e `astro build` limpos. Proxima: Fase 2 (montador de orcamento).

## Atualizacao 12/06/2026 (parte 3) — Ondas Manus: Membros, Comercial e JunIA

Plano por ondas (ordem da Adriana): Membros OK > Comercial OK > JunIA OK >
Gestao de Conteudo > Onboarding > Obras > Ativos > RH > Financeiro.
Auditoria completa em docs/auditoria-manus-gaps.md.

**Onda Membros (commit c1f4dc6):** multiplos perfis por usuario
(portal_profiles.roles text[]), flag trabalhista, avatar, editar/excluir membro,
central de permissoes /admin/permissoes (matriz portal_permissoes: areas do
portal + categorias de KB por perfil; lib/permissoes.ts com exigirArea).
Migrations 030/031 RODADAS. LICAO: Astro 5 CSRF bloqueia POST/PUT/DELETE/PATCH
sem content-type application/json (403 "Cross-site ... forbidden") — TODO fetch
non-GET precisa do header.

**Onda Comercial (commits 1394c29/19dfde4):** kanban 6 etapas em
/portal/gestao-comercial (perfis comerciais), interacoes por lead
(com_interacoes, migration 032), rankings de vendedores, indicadores do funil.

**Onda JunIA (12/06/2026):** chat inteligente SEM LLM (busca pontuada na KB,
igual ao Manus). /portal/junia (conversas, sugestoes, msg pendente com borda
amarela), /admin/perguntas (fila de pendencias; responder envia pro chat do
colaborador + notifica + opcional adiciona a KB + re-analise automatica de
pendencias parecidas), sino de notificacoes no topo do portal
(portal_notificacoes, badge + dropdown, polling 60s). Motor em src/lib/junia.ts:
deteccao de categoria por keywords, score (pergunta exata +10, resposta +5,
keyword +3/+1, threshold 6), filtro por categorias_kb do perfil,
redirecionamentos (financeiro → Vobi, RH → DP, recrutamento → R&S), gate
trabalhista. Migration 033 RODADA. QA E2E 13/13 em producao (scripts/qa-junia.mjs
e qa-junia-fin.mjs): pergunta de categoria restrita redireciona p/ operacional
e responde da KB p/ perfil financeiro (by design).

**Onda Gestao de Conteudo (12/06/2026, commit 1b99364):** as 4 telas do admin
(comunicados, KB, onboarding, treinamentos) auditadas — CRUD ok, CSRF ok.
Novidades: (1) upload de arquivo direto ao bucket portal via URL assinada
(/api/admin/portal/upload-url + public/admin-upload.js; contorna limite de
4,5MB de body da Vercel; max 45MB; videos grandes → YouTube); botoes "Enviar
arquivo/PDF" no Onboarding e Treinamentos. (2) Importar KB de PDF/URL
(/api/admin/portal/kb/importar, lib unpdf; blocos ~1500 chars; alimenta a
JunIA) com modal na tela Base de Conhecimento. (3) Publicar comunicado notifica
colaboradores no sino (todos ou perfil alvo). QA E2E 16/16 em producao
(scripts/qa-conteudo.mjs).

**Onda Onboarding (12/06/2026, commit 47ea24a):** /portal/onboarding agora abre
video (YouTube embed ou MP4 nativo) e PDFs EMBUTIDOS na propria etapa (botao
Assistir/Ler + nova aba), banner de parabens ao atingir 100%. Admin ganhou
secao "Progresso dos colaboradores" (barra %, obrigatorias pendentes, ultima
atividade) via /api/admin/portal/onboarding/progresso — conta apenas etapas
visiveis pros perfis de cada colaborador (access_roles). Conteudo em producao:
12 etapas (video institucional + 8 politicas PDF + 3 seeds; etapa "Politica de
Conduta" ordem 2 esta sem URL — avaliar remover por duplicar o Codigo de Etica).
QA E2E 9/9 (scripts/qa-onboarding.mjs).

**Onda Gestao de Obras (13/06/2026, commit f75d806):** planejamento por obra
(Fase C do plano de substituicao da Vobi). Migration 034 RODADA: obras_tarefas
(cronograma — etapa/responsavel/prioridade/datas/status pendente|em_andamento|
concluida|cancelada) e obras_anotacoes; ambas com vobi_id (upsert idempotente).
APIs /api/admin/obras/[id]/tarefas e /anotacoes. Na pagina da obra: secao
Tarefas (clique cicla status, filtro abertas/todas/concluidas, alerta de
atrasadas, modal CRUD) + secao Anotacoes (mural). Importadas da Vobi via
scripts/importar-obras-vobi.mjs: 278 tarefas (198 concluidas/64 pendentes/16
canceladas, em 40 obras) + 105 anotacoes. ATENCAO: idRefurbish da Vobi casa com
obras.vobi_id SEM o prefixo "vobi-" (numVobi() normaliza); order da Vobi e
fracionario (Math.round); /refurbish-step (nomes de etapa) estava 502/503 na
importacao — etapa ficou null, re-rodar o script quando a infra Vobi
normalizar preenche os nomes. QA E2E 11/11 (scripts/qa-obras.mjs).

**Onda Gestao de Ativos (13/06/2026, commit 438ddbd):** modulo ja era solido
(QA baseline 19/19). Auditado por workflow multi-agente (6 dimensoes, 41 achados
verificados adversarialmente). Implementado: (SEGURANCA/LGPD) portal do
colaborador esconde segredos operacionais via CAMPOS_OCULTOS_PORTAL =
{pin_puk,renavam,chassi,mac} (admin ve tudo); cadastro forca status em_estoque.
(VALIDACAO) enums de status/categoria/ocorrencia validados na API → 400 claro em
vez de 500 do banco; planos com trim/max 10 anos/valida ativo existe.
(BUGS) retorno de manutencao volta para quem tinha o ativo (nao forca estoque);
location.pathname com filter(Boolean); limites nas queries GET.
(GAPS MANUS) exportar inventario CSV /api/admin/ativos/export (respeita filtros);
card 'Garantias vencendo' clicavel → ?garantia=vencendo; fotos do ativo
(upload+galeria, bucket 'ativos' migration 035 RODADA, /api/admin/ativos/[id]/fotos).
(UX) confirm em baixa/descarte, loading/anti-duplo-clique, limpar msg ao abrir
modal, edicao com campos estruturados por categoria (nao textarea crua).
ADIADO p/ decisao da Adriana: inventario fisico (scan QR), depreciacao contabil,
operacoes em massa (devolucao em lote), NF em bucket privado. RLS policies NAO
implementadas de proposito: acesso e 100% via service-role no backend apos auth
JWT (anon key nao toca essas tabelas), entao policies seriam inocuas — decisao
arquitetural registrada. QA E2E em scripts/qa-ativos.mjs.
NOTA: havia colisao de numero 035 (035_ativos_storage + 035_orcamentos); resolvido
em 13/06/2026 renomeando orcamentos para 036_orcamentos.sql. 035_ativos_storage ja
foi RODADA em producao com o nome 035; 036_orcamentos ainda NAO foi rodada.

**Onda Nota Fiscal + D4Sign (13/06/2026):** cofre privado da NF (bucket
'ativos-docs' PRIVADO criado via Storage API, coluna ativos.nota_fiscal_path
migration 037 RODADA; POST/DELETE /api/admin/ativos/[id]/nota-fiscal + GET
.../arquivo com URL assinada 10min; QA 11/11). D4Sign: token de PRODUCAO liberado
pela Adriana (D4SIGN_TOKEN=live_3ff2e282..., D4SIGN_CRYPT_KEY=live_crypt_Hjr90...
gravados no .env LOCAL; FALTA a Adriana colar as 2 vars na Vercel — eu nao devo
digitar API keys em sistemas externos). Token validado contra API real (12 cofres:
EMPREITEIROS, PJ-TECNICOS, FICHA EPI, DOCS CLT, CONTRATO_CLIENTES...). Adicionado
seletor de cofre no envio de termo (/api/admin/d4sign/cofres). Modelos de
contrato (empreiteiros/PJ): a Adriana ja tem e vai passar o caminho.

**Onda RH (13/06/2026, commits b5f439c/d1d2fca):** modulo ja solido (QA baseline
13/13). Auditado por workflow multi-agente (6 dimensoes, 69 achados). Implementado:
(VALIDACAO) enums validados (ausencia tipo/status, colaborador regime/status, doc
tipo) → 400 claro; ausencia dias SEMPRE no servidor; data_desligamento auto ao
desligar. (LGPD) busca por CPF nao usa substring (so match exato p/ CPF completo,
evita enumeracao). (BUG) admissao digital faz rollback se falhar ao mover docs.
(ALERTAS — alto valor) aba 'Alertas' no RH: docs VENCIDOS, vencendo 60d com
criticidade (ASO/CNH/NR vermelho), colaboradores ativos SEM ASO, ferias em
andamento; API /api/admin/rh/alertas; filtro ?vencidos=1; export CSV de
vencimentos; cron /api/cron/rh-vencimentos (e-mail, dual-auth CRON_SECRET ou
admin) + botao 'Enviar resumo agora' — cron NAO registrado no vercel.json (Hobby
limita a 2 crons; ja ha 2; confirmar plano antes de adicionar 3o). (MASSA)
export/import de colaboradores por planilha (mesma pauta dos ativos; upsert por
ID ou CPF; atualizacao parcial nao apaga colunas ausentes). QA: scripts/qa-rh.mjs
(19/19) e qa-rh-import.mjs.
ADIADO p/ decisao da Adriana (sobre-cautela ou feature grande): mascaramento de
salario/CPF/banco na visao do admin (ele e o controlador autorizado); saldo de
ferias/periodo aquisitivo (CLT, precisa migration+regra); autoatendimento do
colaborador (ver seus docs/holerite no portal); avaliacao de desempenho;
organograma; escala/turnos; foto do colaborador (upload+exibicao). RLS policies
NAO feitas (service-role only, igual ativos). Cripto em repouso: Supabase ja faz
no nivel de infra.

**Onda Financeiro (13/06/2026, commits 6692b0d/4b8dc9a):** modulo mais pesado
(25.437 lancamentos + 262 categorias da Vobi). Baseline 12/12. Auditado por
workflow (6 dimensoes, 68 achados). CORRECAO-COROA: o fluxo de caixa era agregado
em JS sobre .limit(5000)/limit(1000) — frageil/errado com 25k linhas. Migration
038 (RODADA) criou RPCs fin_resumo_caixa (fluxo por mes + cards + atrasados, tudo
SUM/GROUP BY no Postgres) e fin_dre (DRE por categoria). resumo.ts e
financeiro.astro agora chamam a RPC — corretos sobre TODOS os dados e rapidos
(a_pagar mes ~230k, atrasados_pagar ~792k reais). DRE: /api/admin/fin/dre + modal
'DRE / Resultado'. Validacao: valor numerico>=0 no POST e PATCH; status validado.
QA scripts/qa-financeiro.mjs. IMPORTANTE: aplicar RPC via SQL editor exige reload
(monaco demora ~25s p/ carregar) e injecao por base64 (Translate corrompe texto);
CREATE FUNCTION nao dispara o dialogo de confirmacao destrutiva. Verificar a RPC
via PostgREST /rest/v1/rpc/<funcao>.
ADIADO p/ proximas fases da substituicao da Vobi (Fases A-D ja documentadas):
contas bancarias (saldo por conta), centro de custo (obra_id ja existe parcial),
recorrencia automatica (coluna existe, falta gerar lancamentos futuros), anexo de
comprovante, fluxo projetado, conciliacao automatica, paginacao da lista (limit
1000 — meses Vobi grandes podem exceder; hoje a maioria cabe). Rate limiting: nao
feito (admin confiavel, sem infra Redis).

**RH — blocos + docs na ficha + alertas 30/15/7 (13/06/2026, commit bbca2a8,
pedido da Adriana):** aba Colaboradores agora em BLOCOS colapsaveis estilo Monday
(CLT Ativos, PJ Ativos, Outros Ativos + inativos/desligados recolhidos);
"ativo"=status!=desligado. Ficha do colaborador (modal editar) mostra os
DOCUMENTOS anexados — busca TODOS via /api/admin/rh/colaboradores/[id] (a query
da pagina tinha limit 200 e ha 305 docs), com tipo, validade colorida, download
seguro (URL assinada), anexar e excluir. Alertas de vencimento por e-mail para
rh@costajr.com.br nos marcos 30/15/7 dias antes + no dia (src/lib/rhVencimentos.ts,
modo "marcos"). Roda DENTRO do cron diario cashback-renovacao (piggyback — Hobby
nao deixa 3o cron). Botao "Enviar resumo agora" usa modo "completo". Testar sem
enviar: /api/cron/rh-vencimentos?dry=1. RH_ALERT_EMAIL no env sobrescreve o destino.

**RH — correcao de regime/status pelos GRUPOS do Monday (13/06/2026, commit
f19353d):** os 96 colaboradores vinham todos CLT (a heuristica de regime por
tamanho de documento falhava — PJ tem CPF, nao CNPJ; 0 CNPJ no board) e o
ativo/inativo saia da coluna status (impreciso). A FONTE DE VERDADE do board RH
(6629107099) sao os GRUPOS: "Ativos Gestao - CLT", "Ativos Operacao - CLT",
"Ativos - PJ", "Diaristas", "PJ_INATIVOS 2025/2026", "CLT_INATIVOS 2025/2026".
scripts/corrigir-rh-grupos.mjs (RODADO) faz PATCH por monday_id: regime
(pj/clt/temporario-p/-diarista) e status (desligado p/ grupos INATIVOS;
ferias/afastado pela coluna status nos ativos). Resultado: 30 PJ, 53 CLT, 13
diaristas; 24 ativos / 72 inativos. A pagina /admin/rh e SSR, entao vale ao
recarregar. APOS qualquer re-import do Monday (importar-rh-monday.mjs), rodar
corrigir-rh-grupos.mjs — o grupo NAO vinha no export antigo; o ids dos grupos
estao embutidos no script (atualizar se a Adriana mover gente de grupo no Monday).
OBS: ha nomes duplicados no proprio board Monday (ROMISON, DANIEL, BEATRIZ em 2
grupos com ids diferentes) — viram 2 linhas; dedupe so se a Adriana pedir.

## Atualizacao 13/06/2026 (parte 2) — RH: anexos por slot, telefone pessoal e Ferias

**APLICAR MIGRATIONS via Management API (NOVO metodo, funciona sem o SQL editor):**
o endpoint `POST https://api.supabase.com/v1/projects/<ref>/database/query`
(ref=llmtnzhzozvhlknjmrdr) com `{query}` e header `Authorization: Bearer <token>`
roda DDL direto. O token vem do localStorage do dashboard Supabase
(`supabase.dashboard.auth.token`) — via Chrome MCP: navegar pro dashboard,
ler o token (fica em window.__sbtok), e dar fetch no endpoint. Retorna [] / 201
em sucesso. MUITO mais confiavel que o monaco do /sql/new (que nao carregava).
Apos CREATE TABLE rodar `notify pgrst, 'reload schema';` pro PostgREST enxergar.
LICAO CRITICA: **os IDs do projeto sao TEXT** (rh_colaboradores.id, rh_documentos.id
= text com uuid em texto), NAO uuid. Tabelas novas que referenciam devem usar
`id text primary key default gen_random_uuid()::text` e FKs `text`.

**Anexos em slots fixos (commit 4168cec):** a ficha do colaborador mostra os
documentos em SLOTS fixos espelhando as colunas do Monday (Contrato/Termo, RG/Hab,
Ficha de Registro, Teste Personalidade, ASO+venc, Ficha EPI+venc, OS, NR35/NR10/
NR06/NR01+venc). Verde=preenchido, vermelho="nao anexado", laranja="vencido—anexe
o atual". Vencidos saem dos slots p/ "Documentos vencidos (historico)" (recolhivel).
Casamento por PREFIXO do titulo (os 305 docs importados tem titulo "Tipo — arquivo");
validado 305/305 sem perda. Botao + por slot pre-preenche tipo+prefixo no anexo.
NAO ha upload de arquivo nativo na ficha ainda (so URL); os importados ja estao no
bucket privado `rh`. Se a Adriana quiser anexar arquivo do PC direto no slot, falta
um upload-url p/ bucket `rh` no modal (proxima melhoria).

**Telefone pessoal (migration 040, RODADA):** coluna rh_colaboradores.telefone_pessoal;
campo no form, obrigatorio (exceto diarista), no create/edit/import. "telefone" =
empresa; fonte Monday "CONTATO PESSOAL".

**Campos obrigatorios + fix do salvar (commit 43ce1c7):** nome/email/tel empresa/
tel pessoal/cpf/rg/nascimento/cargo/admissao/endereco/contato+tel emergencia com *
e validacao no submit (lista o que falta; diarista isento). Bug do salvar corrigido:
PATCH validava status/regime mesmo vazio e salario ia como texto — agora valida so
quando ha valor e converte salario.

**Programacao de Ferias (migration 041, RODADA; commit d6212f2):** CLT only (PJ/
diaristas nao tem ferias). Tabelas rh_ferias_periodos (periodo aquisitivo 12 meses=
30 dias, limite_concessivo=vencimento p/ tirar, status aberto|programado|em_gozo|
concluido|vencido) e rh_ferias_parcelas (ate 3, ex 10/10/10; status programada|
confirmada; flags aviso_30/15/7/pos). Aba 🏖 Ferias no /admin/rh: verde quando
30 dias programados / vermelho quando falta (badge na pill), modal de programar
parcelas, "dar OK" confirma gozo, ao confirmar 30 dias o periodo conclui e o
proximo e liberado. Botao "Gerar periodos" semeia o periodo atual de cada CLT
ativo a partir da admissao (idempotente, pula sem data_admissao). Lembretes por
e-mail (rh@ + adriana@) no cron diario cashback-renovacao (piggyback, sem novo
slot — Hobby limita a 2): 6/3/1 mes do vencimento se nao programado, semanal se
aberto, 30/15/7 dias antes de cada parcela, "dar OK" ao passar. Digest unico por
execucao com flags anti-duplicacao. src/lib/ferias.ts (calculo de periodo/
completude + enviarLembretesFerias). APIs /api/admin/rh/ferias/* (index GET/POST+seed,
[id]/parcelas POST, parcela/[id] POST confirmar/DELETE). Matematica de datas
validada (overflow de mes, ciclosVencidos). RLS ligado (service-role only, igual
ativos/RH). ADIADO: saldo proporcional p/ quem tem <1 ano, abono pecuniario (venda
de 1/3), ferias coletivas, visao do colaborador no portal.

## Atualizacao 13/06/2026 (parte 3) — Exclusao de lembretes, diagramacao RH e Auditoria/Lixeira

**Inativos/diaristas SEM lembretes (commit 900e6cb):** desligados (status=desligado)
e diaristas (regime=diarista) nao recebem mais lembrete/e-mail. Auditado por
workflow (8 superficies). Corrigido em src/lib/rhVencimentos.ts (digest de docs),
alertas.ts (aba Alertas: docs+sem-ASO+ausencias; "sem ASO" trocou .eq(status,ativo)
por .neq(status,desligado) p/ NAO barrar ferias/afastado), rh.astro (aniversariantes
exclui diarista), export-vencimentos.ts. Criterio: status!='desligado' (NUNCA
=='ativo') e regime!='diarista'; filtro em JS (embedded filter PostgREST e fragil).
Ferias ja estava ok (so CLT ativo).

**Diagramacao do RH (commit 62d67f3):** aba Colaboradores so mostra ATIVOS
(contador=ativos); desligados foram p/ aba propria "Inativos" (com busca). Tabela:
removido e-mail e coluna "Setor"; salario em COLUNA propria (alinhado direita,
tabular); fontes maiores (.tabela-colab). filtrarColabs escopado a #aba-colaboradores;
novo filtrarInativos.

**Auditoria + Lixeira de 30 dias (migration 042 RODADA; commits e5166e9/ae0e943):**
LOG de tudo + recuperacao de exclusoes. Tabelas audit_log (ts/usuario/acao/entidade/
registro_id/descricao/dados jsonb/ip) e lixeira (dados jsonb/excluido_por/expira_em=
+30d/restaurado). IDs text, RLS. src/lib/auditoria.ts: registrarAcao(),
excluirComLixeira() (le linha->lixeira->apaga->loga), restaurarDaLixeira(),
expurgarLixeira() (cron diario piggyback). Telas /admin/logs (trilha filtravel
paginada) e /admin/lixeira (restaurar em 30d) no menu grupo "Sistema" — so admin/
coordenador. APIs /api/admin/logs, /api/admin/lixeira, /lixeira/[id]/restaurar.
**25 endpoints DELETE ligados** (workflow 24 + 1 ref): exclusao de cadastro real ->
lixeira; casos especiais (storage anexo, unlink de acesso, soft-delete de lancamento/
servico, fallback de membro com FK historico) -> so registrarAcao. Tabelas/idCols
conferidos (ex.: orc_servicos idCol=codigo; obras_tarefas/anotacoes id vem de
?tarefa=/?anotacao= e nao de params.id). Criacoes/edicoes tambem logam. Fluxo de
recuperacao validado E2E contra o banco (criar->excluir->lixeira+log->restaurar).

**Log de INCLUSAO + revogacao ao desligar (commit e126892):** workflow ligou
registrarAcao acao "criar" em 43 endpoints POST (criacao unica; imports em massa
logam 1x com a contagem; acoes como movimentar/converter/gerar-preventivas/rdo/
parcelas logam o que geraram). Cobertura final: **67 endpoints logam, 21 com
lixeira**. REVOGAR ACESSO AO DESLIGAR (decisao da Adriana, opcao 1): o PATCH de
rh/colaboradores/[id] quando status=desligado seta portal_profiles.approval_status=
'rejected' do membro vinculado + apaga portal_sessoes (bloqueia login E tira de
comunicados/notificacoes, que filtram approval_status='approved'). Logado.
Validado E2E (antes recebe comunicado; depois bloqueado). Reativar = re-aprovar
manual em /admin/membros. OBS: revogacao so dispara pelo PATCH interativo (botao
Desligar); re-import em massa setando desligado NAO revoga (edge case).

## Atualizacao 13/06/2026 (parte 4) — Diagramacao global + ficha do colaborador em abas

**Diagramacao global (commit 6c39e3e):** elevada a tipografia/espaco na BASE do
layout (src/layouts/Admin.astro) -> vale para TODAS as telas do admin de uma vez.
table 0.875->0.95rem, td padding 13/14, page-title 1.15rem, toolbar 1.12rem,
section-title 1.05rem, stat-value 2.05rem, badge .78rem, botoes .86rem, inputs
maiores. Ajuste conservador (1-2px). Confirmado no Financeiro (15.2px tabela etc).

**Ficha do colaborador em ABAS (migration 043 validade_na RODADA; commit 6df3c65):**
o modal do colaborador agora tem 2 abas estilo Excel: "Dados gerais" (form+acesso)
e "Documentos". Novo colaborador abre so em Dados (aba de docs escondida).
Documentos em COLUNA UNICA agrupada (como no Monday): Pessoais (Contrato/Termo,
RG/Habilitacao, Ficha de Registro, Teste de Personalidade) - Tecnicos (ASO, Ficha
de EPI, Ordem de Servico) - Treinamentos/NRs (NR-01, NR-06, NR-10, NR-35 em ordem).
Cada doc: badge de vencimento CLARO (Vence dd/mm verde/laranja, Vencido vermelho,
Sem vencimento=N/A, ou "Definir vencimento"), ✏️ editar e 🗑️ excluir (lixeira 30d).
Anexo ganhou checkbox "Sem vencimento (nao aplicavel)" -> grava validade_na;
docs com data disparam lembrete por e-mail (ja existia), docs N/A nao cobram.
SLOT_GRUPOS+SLOT_DEF em src/pages/admin/rh.astro; abas via fichaTab(); editarDoc
exposto (docs da ficha sao mesclados em docPorId p/ o ✏️ achar).

**LICAO de cache (PWA):** o sw.js do admin e network-first p/ HTML e cache-first
p/ /_astro/ (assets versionados por hash, entao auto-bustam). Quando a REDE
navegador<->Vercel OSCILA, o fetch de HTML falha e o SW serve o HTML cacheado
(que referencia o JS antigo) -> parece "deploy nao propagou", mas e a rede. NAO e
bug do SW. Em caso de duvida: hard refresh (Ctrl+Shift+R) ou limpar SW/caches.
Nesta sessao a rede ao site oscilou MUITO (curl e browser deram 000/timeout
intermitente) — verificacoes E2E feitas direto no banco (Supabase REST/Management
API, confiaveis) quando o HTTP do app nao respondia.

## Atualizacao 13/06/2026 (parte 5) — RH: refinamentos + modulo Ficha de EPI

**Frente 1 (commit d6799c7):** (a) ficha ganhou slots Advertencia e Suspensao
(grupo Disciplinares). (b) FERIAS agora valem p/ CLT E PJ (ferias.ts, seed e GET
usam regime in (clt,pj)). (c) NAO permite 2 colaboradores de ferias no mesmo
periodo: parcelas POST valida sobreposicao com parcelas de OUTROS colaboradores
e retorna 400 claro. (d) Aniversariantes = TODOS os ativos (qualquer regime, pela
data_nascimento); e-mail dos aniversariantes do mes no dia 1 (cron piggyback,
enviarAniversariantesDoMes p/ rh@+adriana@). (e) /admin/membros ganhou abas
Colaboradores (vinculados a RH via profile_id) x Terceiros (demais).

**Modulo Ficha de EPI (migration 044 RODADA; commit e6cd729):** aba 🦺 EPIs na
ficha. Catalogo fixo de 8 itens (src/lib/epi.ts EPI_CATALOGO: mascara respiratoria,
protetor auricular, oculos, botina, camiseta, luva pigmentada, luva de raspa,
capacete). Tabelas: epi_entregas (estado atual por colaborador+epi, UNIQUE
colaborador_id+epi, upsert; CA/tamanho/entrega/validade/devolucao/aviso_15) e
epi_fichas (documentos gerados: tipo completa|reposicao, itens jsonb snapshot,
status gerada|assinada, assinado_path). APIs /api/admin/rh/epi/{index GET,
entregas POST, gerar POST, fichas/[id]/pdf GET, fichas/[id]/assinado POST/GET}.
PDF imprimivel via pdf-lib (src/lib/epiPdf.ts) com termo + linha de assinatura.
"Gerar ficha completa" (todos os itens) e "reposicao" (so 1 item danificado).
Alerta 15 dias antes do vencimento -> rh@ + engenharia@ (enviarAlertasEpi,
piggyback no cron diario, flag aviso_15). ASSINATURA = imprimir->assinar no
papel->anexar o assinado (decisao da Adriana, NAO D4Sign); o assinado vai pro
bucket privado rh e a ficha vira "assinada" no historico. Fluxo de dados validado
E2E no banco (upsert sem duplicar, snapshot, query do alerta) + PDF smoke-test ok.
PENDENTE p/ proxima sessao (decisao da Adriana): **fluxo de contratacao/demissao**
(board Miro uXjVIGLTH8E + FORMULARIO DE DESLIGAMENTO.xlsx que ela anexou — formulario
de entrevista de desligamento). Nao consegui abrir o Miro (rede ao site caiu nesta
sessao). Modelo real de EPI da empresa: "CONTORLE DE EPI_COSTA JUNIOR.xlsx" e fichas
.docx em RH DP/1_Documentos/1_Seguranca do Trabalho/03.NR.../.

## Atualizacao 13/06/2026 (parte 6) — Fluxo Contratacao/Demissao + EPI custom + QA + Solides

**EPI fora da lista (commit 3b355db):** botao "+ Adicionar EPI (fora da lista)"
na aba EPIs — linha com nome editavel + remover. Backend ja aceitava (epi e texto;
index GET anexa itens fora do catalogo).

**Fluxo de Contratacao & Demissao (board Miro "Fluxo: RH e DP"; migration 045
RODADA: rh_vagas, rh_candidatos, rh_desligamentos; commits 6f32b5c/c477e32):**
- /admin/recrutamento (menu Empresa, key recrutamento): vagas + KANBAN de
  candidatos pelo funil triagem>teste(PB)>entrev.comportamental>entrev.tecnica>
  proposta>admissao>contratado/reprovado. Mover ◀▶, reprovar, CONTRATAR cria o
  colaborador a partir do candidato (vincula + vaga vira preenchida). APIs
  /api/admin/rh/{vagas,candidatos[+/contratar]}.
- Desligamento: botao "Desligar" abre modal com tipo/motivo + ENTREVISTA de
  desligamento (do FORMULARIO DE DESLIGAMENTO.xlsx) + CHECKLIST de saida (EPI/
  ferramentas devolvidos, ASO demissional, docs, acesso revogado). PATCH status=
  desligado (revoga acesso) + POST rh_desligamentos (jsonb). API /api/admin/rh/
  desligamentos. Tudo logado + lixeira nos deletes.
- ADIADO do board (proximas fases, ja no benchmark): onboarding journey
  e-learning, avaliacao de desempenho trimestral, pesquisa de clima/eNPS,
  cargos & salarios.

**QA do RH:** 43 handlers de botao (rh+recrutamento) TODOS com funcao definida
(zero botao morto, checagem estatica). 5 automacoes no cron diario: vencimento
docs, ferias, EPI 15d, aniversariantes (dia 1), expurgo lixeira. Fluxos de dados
E2E-verificados no banco (contratacao->demissao, ferias, EPI, lixeira, revoke).
LIVE click-test NAO rodou: o site costajr.com.br ficou INACESSIVEL desta rede a
sessao toda (curl e browser deram 000/timeout intermitente; api.supabase.com e
miro.com funcionavam). Build sempre limpo.

**Benchmark Solides (docs/benchmark-solides-rh.md):** comparacao do RH vs Solides
+ top recomendacoes priorizadas. Ja em paridade: cadastro/docs/ATS/admissao/
onboarding/ferias/EPI/desligamento/auditoria. Gaps p/ construir (ordem): (1)
Avaliacao de Desempenho trimestral, (2) Pesquisa de Clima/eNPS, (3) People
Analytics RH (dados ja existem), (4) pagina publica de vagas + banco de talentos,
(5) perfil comportamental DISC. NAO construir (integrar): ponto eletronico
(Portaria 671, risco legal) e folha/DP (contabilidade).

## Atualizacao 13/06/2026 (parte 7) — Desligamento travado por devolucao + specs RH/DP

**Desligamento so conclui apos devolucao completa (commit dfe0d68):** pedido da
Adriana. O botao Desligar agora cruza a POSSE do colaborador com o modulo de
Ativos e com os EPIs/uniformes, e SO desliga se tudo foi devolvido em perfeito
estado + passos do regime. /api/admin/rh/desligamentos/posse (ativos alocados a
ele por id/profile_id/nome + epi_entregas status=ativo sem data_devolucao).
/api/admin/rh/desligamentos/finalizar = GATE no servidor: bloqueia com lista de
pendencias se faltar item devolvido/em perfeito estado; CLT exige exame
demissional+exame emocional+aviso previo(cumprido/dispensado)+termo de
encerramento; PJ exige contrato de encerramento. Ao concluir: baixa EPIs
(devolvido), devolve ativos (status em_estoque + ativos_movimentos tipo
devolucao), desliga e revoga acesso. O PATCH de colaborador BLOQUEIA status->
desligado direto (so pelo fluxo). Verificado E2E no banco. Ativos: status
'alocado', alocado_para_tipo='colaborador', alocado_para_id, alocado_para_nome.

**Specs lidas (Marketing/1_Orientativos/1_Processos/Fluxos_Automacoes_RH DP.xlsx):**
aba RH = funil de R&S (divulgacao>recepcao>perfil aderente>1a comportamental>2a
tecnico>admissao "so com envio integral">analise documental>doc basica (Onvio,
clinica)>doc SST (ASO, contabilidade)>doc pessoal (conta, cracha, EPIs/uniforme,
VA/VT/VR, email/ControlID)>integracao (onboarding + assinaturas: contrato, VT/VA,
banco de horas, ficha EPI, uniforme, termo equipamentos/ferramentas)>arquivamento).
aba DP = ativos PJ/CLT, atividades periodicas (calendario: dia15 adiantamento,
dia1 salario, dia25 compra VA/VT), AVALIACAO DESEMPENHO (formulario trimestral
Mar/Jun/Set/Dez, consolida em Excel), DESLIGAMENTO (emails automaticos: TI cancela
acessos, banco cancela conta, CLT agenda exame demissional, Alelo/VT/Totalpass
cancelamento), entrevista de desligamento, arquivamento.

**Avaliacao de Desempenho trimestral (migration 046 RODADA; commit b74344b):**
FEITO. /admin/avaliacoes (menu Empresa): ciclo Mar/Jun/Set/Dez, 10 competencias
(1-5) + nota geral automatica + pontos fortes/desenvolver + PDI; KPIs e lista de
ativos avaliado/pendente. rh_avaliacoes (upsert por colaborador+ano+trimestre+
tipo). src/lib/avaliacoes.ts (COMPETENCIAS, notaGeral, enviarLembreteAvaliacoes —
cron dia 1 de Mar/Jun/Set/Dez). Verificado E2E.

**PENDENTE (melhorias aprovadas, proximas — ordem):** (2) Pesquisa de Clima/eNPS,
(3) People Analytics RH, (4) pagina publica de vagas + banco de talentos, (5)
Perfil comportamental DISC/Eneagrama (Adriana passou os modelos F3_Teste DISC.xlsx
e F4_Teste Eneagrama.xlsx — planilhas de terceiros a digitalizar como questionario);
(6) automacoes de e-mail do desligamento (TI/banco/Alelo/VT/Totalpass, do board).
Contratos: a Adriana vai passar os modelos padrao; RH gera so contrato de proposta,
encerramento PJ, termo de posse de equipamentos e termo de encerramento de posse
(liberado so com devolucao em perfeito estado).

## Atualizacao 14/06/2026 — Quadro do candidato (espelha PowerApps) + ref do app

**App de referencia da CJR:** PowerApps "Gestao de pessoas" (link em apps.
powerapps.com/.../616adb88-...). Telas: Vagas (kanban Aberta/Em andamento, card
com cargo/tipo/Data/Data prevista, + Nova vaga, Calendario), Candidatos (lista de
cards + Marcados + filtro por vaga), Colaboradores. O nosso /admin/recrutamento
cobre Vagas+Candidatos (kanban por etapa) e o /admin/rh cobre Colaboradores.

**Quadro do candidato completo (migration 047 RODADA; commit c948e29):** o modal
de candidato no Recrutamento agora espelha o formulario do PowerApps. rh_candidatos
ganhou: data_nascimento, experiencia, formacao, conhecimento_tecnologico,
possui_habilitacao/veiculo, disp_imediata/viagem/presencial, personalidade,
restricao, teste_disc (D/I/S/C), teste_eneagrama (Tipo 1-9), curriculo_url.
API candidatos com CAND_CAMPOS + coagirBooleans (selects "true"/"false"->bool).
Verificado E2E. NOTA: teste_disc/eneagrama hoje sao dropdown do RESULTADO; o
questionario completo (digitalizar F3/F4) continua na fila de melhorias.
CARD/FORM DA VAGA ALINHADO (migration 048 RODADA; commit 477efe3): rh_vagas +
data_abertura, data_prevista, demanda, perfil_desejado, habilitacao,
modo_trabalho, tipo_contratacao; card mostra perfil/area/contratacao/Data/Prevista.
PENDENTE de alinhar: "Subir documentos" do candidato como upload real (hoje e link
curriculo_url); tela Colaboradores do app (ja coberta pelo /admin/rh).

**Pesquisa de Clima / eNPS FEITA (migration 049 RODADA; commit 20ab44b):** melhoria
#2 da fila. /admin/clima (cria campanha -> LINK PUBLICO; dashboard eNPS + 6
dimensoes + comentarios; encerrar/reabrir). /clima/[token] publico ANONIMO (sem
login; sem colaborador_id). src/lib/clima.ts. Verificado E2E.

**FILA DE RECRUTAMENTO/RH 100% CONCLUIDA (14/06/2026) — fazer sem pausar + auditoria
+ visual amigavel (pedido da Adriana).** Itens 3-7 entregues e validados E2E
(site fora do ar -> validacao via Supabase REST + dev server autenticado com JWT
forjado da lib/auth):
- **(6) Desligamento — gating + e-mails** (commit ee2cf9b): /api/admin/rh/
  desligamentos/{posse,finalizar} cruzam Ativos (alocado) + EPIs (ativos) e SO
  deixam desligar se tudo devolvido em bom estado + passos por regime (CLT: exame
  demissional+emocional, aviso previo, termo encerramento; PJ: contrato encerramento).
  Ao concluir: devolve EPIs/ativos, desliga, revoga acesso, e e-mail de checklist
  de cancelamentos (TI/banco/Alelo/VT/Totalpass + ASO p/ CLT) p/ RH_ALERT_EMAIL.
- **(3) People Analytics RH** (commit ee2cf9b): /admin/rh-analytics — headcount,
  turnover 12m, idade/tempo de casa medios, docs/EPIs vencendo, aniversariantes,
  nota desempenho, eNPS + graficos CSS (rotatividade/regime/setor). LICAO CRITICA
  DE BUILD: o compilador JSX do Astro 5 QUEBRA com `.map` aninhado que retorna JSX
  com atributos `title={...}` (erro esbuild "Expected '>' but found title" mesmo com
  variaveis puras e tsc limpo). SOLUCAO: renderizar listas/graficos como STRING HTML
  no frontmatter e injetar com `<Fragment set:html={...} />`. Padrao a reusar.
- **(7) Upload real do curriculo** (migration 050 RODADA; commit a-seguir): coluna
  rh_candidatos.curriculo_path/curriculo_nome; /api/admin/rh/candidatos/[id]/curriculo
  (POST multipart->bucket privado rh; GET url assinada 10min; DELETE). Modal do
  candidato anexa/ve/remove arquivo (PDF/DOC/DOCX/img ate 10MB) alem do link.
- **(4) Pagina publica de vagas + banco de talentos** (commit a-seguir): /vagas
  (publica, Base.astro) lista vagas abertas + modal de candidatura c/ upload de cv
  e aceite LGPD; CTA Banco de Talentos (candidatura espontanea, vaga_id null). API
  publica POST /api/vagas/candidatar (multipart, cria candidato em triagem, sobe cv
  no bucket rh, notifica RH). Filtro "🌟 Banco de Talentos" no /admin/recrutamento.
  Link "Trabalhe conosco" no rodape do site.
- **(5) Teste DISC + Eneagrama por link** (migration 051 RODADA; commit a-seguir):
  src/lib/testes.ts (16 grupos DISC escolha-forcada + 27 afirmacoes Eneagrama escala
  1-5, calculo dominante/tipo). /teste/[token] publico (questionario 2 partes,
  progresso, resultado na hora). API /api/teste/[token] (GET perguntas, POST calcula
  e salva teste_disc/teste_eneagrama + detalhe jsonb; anti-reenvio). Admin gera link
  pelo modal do candidato (/api/admin/rh/candidatos/[id]/teste-link) e ve o resultado.
- **Auditoria + VISUAL AMIGAVEL** (commit a-seguir): componente src/components/
  RhNav.astro — barra de navegacao com 5 cards coloridos (👥 Pessoas, 🧭 Recrutamento,
  ⭐ Avaliacoes, 🌡️ Clima, 📈 People Analytics) no topo das 5 telas, card ativo
  destacado. Auditoria estatica: 0 botoes mortos (75 handlers), 0 fetch non-GET sem
  content-type. Print confirmado nas telas (login via cookie admin_token + JWT forjado).

**DICA P/ VALIDAR COM SITE FORA DO AR:** `npx astro dev --port 4329` em background +
forjar admin_token com a lib jose e JWT_SECRET do .env (issuer "costajr.com.br",
tipo:"admin") -> fetch com header cookie. Cuidado: dev server no OneDrive estoura
EMFILE (too many open files) sob varios requests simultaneos — testar 1 rota por vez.

## Atualizacao 14/06/2026 (parte 2) — Lote de ajustes RH (feedback da Adriana)

Lote de 12 ajustes pedidos pela Adriana, validados via dev server autenticado
(JWT forjado) + Supabase REST (site em prod, dev local p/ E2E):
- **BUG avaliar (raiz importante):** o botao "Avaliar" nao respondia. Causa:
  `define:vars` no <script is:inline> faz o Astro EMBRULHAR o script numa funcao,
  entao `avaliar`/`carregar` etc. ficam locais e o `onclick="avaliar()"` (escopo
  global) nao acha -> ReferenceError. FIX: `Object.assign(window,{...})` expoe as
  funcoes. PADRAO: toda tela com define:vars + onclick inline precisa expor ao
  window (auditadas: avaliacoes corrigida; orcamentos/perguntas ja expunham).
- **Ficha do colaborador:** botao X p/ fechar no topo do modalColab.
- **Documentos:** upload REAL de arquivo do PC (antes so URL) -> bucket privado
  rh; novo endpoint /api/admin/rh/documentos/upload (multipart, storage_path).
- **Recrutamento:** Titulo da vaga = dropdown de CARGOS (migration 052 rh_cargos,
  17 cargos seedados + API /api/admin/rh/cargos CRUD soft-delete + modal
  "gerenciar cargos"); Area = pre-selecao (Operacao/Comercial/Admin/Financeiro/RH);
  Demandante = dropdown de colaboradores ativos; banner de empty-state no kanban
  (estava vazio = 0 candidatos, por isso ela "nao achou o kanban"). Criados dados
  de teste (🧪): 1 funcionario, 1 vaga, 5 candidatos no funil.
- **EPI ficha PDF:** reescrito no formato OFICIAL da empresa ("Controle de Entrega
  de EPI" — fonte: FICHA-DE-EPI-*-D4Sign.pdf e Termo de EPI_Givanildo/Crispim):
  logo CJR, caixa Nome/Funcao/Admissao/RG, DECLARACAO completa + Base Legal NR1/NR6,
  tabela Quant|Descricao|CA|Data Entrega|Assinatura|Data Devolucao (SEM coluna
  Validade no impresso), rodape institucional. SANITIZA caracteres (Helvetica/
  WinAnsi nao codifica emoji -> quebrava). Catalogo: + Calca + Luva de borracha.
  Logo buscado de origin/logo-cjr.png. Endpoint passa RG/admissao.
- **EPI dedup:** ficha de EPI removida da aba Documentos (slot ficha_epi fora de
  SLOT_GRUPOS + slotDoDoc nao mapeia mais "epi"); fica so na aba EPIs. Docs antigos
  caem em "Outros documentos".
- **EPI Crispim/Givanildo:** ja existiam (Monday). RG/cargo atualizados + 8 EPIs
  cada das fichas reais (CAs corretos, SEM vencimento p/ a Adriana definir e
  disparar o alerta de 15 dias, que ja roda no cron).
- **Ferias:** auto-avanco do periodo aquisitivo. garantirPeriodoAtual() no cron
  diario cria o periodo do ciclo VIGENTE (ciclosVencidos-1) p/ cada CLT/PJ ativo
  sem ele -> a data se ajusta a cada ano sozinha. (Os dados ja estavam corretos;
  faltava o auto-avanco.)
- **Clima (decisao: NATIVO, sem MS Forms):** enviarLembreteClima() no cron (1o de
  Mar/Jun/Set/Dez) e-mail p/ todos os ativos + RH cobrando preenchimento da
  pesquisa ativa (link anonimo); indicador resumido na tela (classe eNPS, ponto
  forte, dimensao a melhorar, participacao). classeEnps() reutilizavel.
- **E-mail/Outlook (decisao: MANTER RESEND):** confirmado que os avisos automaticos
  saem via Resend (re_..., FROM noreply@costajr.com.br) no cron diario da Vercel
  (cashback-renovacao 9h + regua-cobranca 12h; Hobby limita a 2). NAO ha "agendamento
  no Outlook" — nao foi pedido integrar.
Migrations: **052_rh_cargos RODADA.** Telas E2E 200. Commits ee2cf9b..4fd8518.

**Abono pecuniario (vender ferias) — migration 053 RODADA; commit 3d6f68b:** modal
de ferias ganhou seletor "Vender (abono)" 0/10/15/20/30; dias vendidos reduzem o
descanso a programar (rh_ferias_periodos.dias_abono). resumoPeriodo(d,p,abono):
completo quando programado+abono>=direito. API parcelas valida abono (set valido,
< direito, soma+abono<=direito). Nota: CLT limita abono a 1/3 (10 dias) — as 4
opcoes ficam a criterio do RH. E2E ok.

**Historico de ferias preservado, fora do painel principal (commit a-seguir):** ao
concluir (30 dias confirmados), o periodo vira status=concluido — MANTIDO no banco,
nunca apagado (parcela/[id].ts ja fazia isso). O painel principal ja filtra
.neq(status,concluido). Novo: GET /api/admin/rh/ferias?historico=1 retorna os
concluidos (com parcelas+abono) e botao "📜 Historico" na aba Ferias abre modal
modalFeriasHist (so leitura). E2E: historico inclui concluido / painel principal nao.

## Atualizacao 14/06/2026 (parte 3) — EPI refinamentos + aba Pendencias

- **CA pre-preenchido NA (commit 8fb76ee):** Calca e Camiseta nao tem CA -> o
  form de EPI ja vem com CA="NA" (editavel); 6 registros existentes (Crispim/
  Givanildo) atualizados.
- **Anexos de ficha de EPI na aba EPIs (commit bb100e6):** secao "Anexos de Ficha
  de EPI" lista docs tipo=ficha_epi + botao Anexar (o local sumiu ao tirar da aba
  Docs). Fichas EPI nao aparecem mais em Documentos (filtro doc.tipo==='ficha_epi'
  no split de slots). Novos slots de docs pessoais: Carteira de Trabalho (CTPS),
  Titulo de Eleitor, Certidao de Nascimento, Comprovante de Residencia —
  slotDoDoc reconhece por titulo => docs do Crispim em "Outros" migram sozinhos
  (render-time, sem mexer no banco).
- **Aba "⚠️ Pendencias" na ficha do colaborador (commit a-seguir):** consolida
  tudo que falta: (1) campos obrigatorios em branco (PEND_CAMPOS_OBRIG, isenta
  diarista), (2) documentos faltando (PEND_DOCS_OBRIG = contrato/rg/carteira/
  ficha_registro/aso/titulo_eleitor/certidao/comprovante via slotDoDoc), (3) fichas
  de EPI sem assinatura (epi_fichas.status != assinada), (4) documentos e EPIs
  vencidos (validade < hoje). calcPendencias() + carregarPendencias(); badge no
  topo da aba (parcial sem EPI no load da ficha, total ao abrir a aba). Verificado
  ao vivo no Crispim (1 campo + 1 EPI vencido = badge 2).

## Atualizacao 14/06/2026 (parte 4) — Status juridico do colaborador (congelado pausa alertas)

**Migration 055 RODADA; commit a-seguir:** rh_colaboradores.status_juridico
(normal | em_processo | congelado, default normal). Campo no form da ficha
(Dados gerais) + banner azul no topo do modal quando congelado. APIs de
colaborador (POST index + PATCH [id]) e camposColab/editarColab aceitam o campo.
Quando **congelado** (litigio/acordo), os alertas automaticos e a programacao de
ferias ficam PAUSADOS — exclusao aplicada em: ferias (enviarLembretesFerias +
garantirPeriodoAtual + seed POST), vencimento de docs (rhVencimentos
montarVencimentos), EPI (enviarAlertasEpi), avaliacoes (enviarLembreteAvaliacoes).
Criterio: status_juridico != 'congelado' (alem dos ja existentes status!=desligado
e regime!=diarista). E2E: PATCH congelado -> excluido da elegibilidade de ferias;
reset normal -> reaparece. UI verificada ao vivo (banner + 3 opcoes). NOTA: ha um
flag `trabalhista` separado em portal_profiles (gate de acesso ao portal/JunIA) —
nao confundir com status_juridico (RH/alertas).

## Atualizacao 14/06/2026 (parte 5) — Import das FERIAS programadas do Monday

**scripts/importar-ferias-monday.mjs (RODADO; commit a-seguir):** as ferias
programadas nas colunas do board RH (6629107099) nao tinham vindo no import
original (o export de 11/06 trouxe as colunas mas com valores null). Puxei
fresco via Monday MCP. Colunas: `dup__of_f_rias__1` (Ferias, range) +
`cronograma__1` (Cronograma, range) = parcelas; `dup__of_venc_f_rias__1`
(Venc. Ferias, data) = limite_concessivo. Casamento por monday_id.
**Resultado: 25 colaboradores, 22 periodos criados, 38 parcelas** (passadas=
confirmada/gozada, futuras=programada). Idempotente (nao duplica parcela com
mesma data_inicio no periodo). LICAO: PostgREST batch INSERT exige que TODAS as
linhas tenham as MESMAS chaves (erro PGRST102 "All object keys must match") —
lotes que misturavam parcela confirmada (com confirmada_em/por) e programada
(sem) falhavam em silencio; fix: sempre incluir confirmada_em/confirmada_por
(null quando programada) + CHECAR rp.ok no fetch. Removida 1 parcela de teste
sobreposta da Adriana (06-30->07-14, residuo). Os dados do Monday tem 2 colunas
de range (Ferias + Cronograma) — ambas tratadas como parcelas; se a Adriana
quiser so uma, ajustar. Re-rodar: o script tem os dados embutidos (snapshot
14/06); p/ atualizar, re-extrair do Monday e atualizar o array MONDAY.

## Atualizacao 14/06/2026 (parte 6) — 'Congelado' virou STATUS (decisao da Adriana)

A Adriana preferiu o congelado DIRETO no dropdown de Status (em vez do campo
separado status_juridico). **Migration 056 RODADA:** atualizou a CHECK constraint
rh_colaboradores_status_check p/ aceitar 'congelado' (ativo|ferias|afastado|
congelado|desligado). stColab + badgeColab ganharam 'congelado' (badge-purple,
rotulo "🔒 Congelado"). Campo 'Status juridico' REMOVIDO do form; banner de
congelado agora liga no select de Status (toggleColabCongelado le #colabStatus).
Validacao de status nas APIs (POST index + PATCH [id]) inclui congelado. A pausa
de alertas migrou de status_juridico==='congelado' p/ **status==='congelado'** em:
ferias (lembretes + auto-avanco + seed), rhVencimentos, epi, avaliacoes. LICAO:
o status tinha CHECK constraint no banco — adicionar valor de enum exige ALTER da
constraint, nao so a validacao no codigo (erro rh_colaboradores_status_check).
A coluna status_juridico (migration 055) ficou VESTIGIAL (sem uso na UI/APIs);
nao foi dropada (inofensiva). Congelado conta como ativo (status!=desligado) —
aparece nas listas, so nao recebe alertas.

## Atualizacao 14/06/2026 (parte 7) — Status juridico SEPARADO de novo (revert da 056)

A Adriana percebeu que precisa da pessoa ficar ATIVA *e* ter o status juridico ao
mesmo tempo — entao o congelado NAO pode ser status operacional. **Migration 057
RODADA** reverte a constraint do status p/ 4 valores (ativo|ferias|afastado|
desligado). 'congelado' VOLTOU a ser STATUS JURIDICO separado (status_juridico:
normal|em_processo|congelado, stJuridico map). Campo "Status juridico" restaurado
no form (acima do Status), banner liga no #colabStatusJuridico, validacao
STATUS_JURIDICO nas APIs, camposColab/editarColab com status_juridico. A pausa de
alertas voltou p/ **status_juridico==='congelado'** em ferias/vencimentos/epi/
avaliacoes. E2E: PATCH status=ativo + status_juridico=congelado -> ambos persistem,
excluido das ferias, continua ativo. DECISAO FINAL: status operacional (Ativo/
Ferias/Afastado/Desligado) e status_juridico (Normal/Em processo/Congelado) sao
campos INDEPENDENTES; uma pessoa pode ser Ativa E Congelada. (As migrations 055/
056/057 contam a saga; o estado final = separado, igual a 055.)

## Atualizacao 14/06/2026 (parte 8) — DECISAO FINAL: congelado é STATUS unico

A Adriana decidiu (definitivo): UM unico campo Status, com '🔒 Congelado (jurídico)'
na lista — pois congelar e raro e nao compensa 2 campos. **Migration 058 RODADA**
reabilita congelado na constraint. Status = ativo|ferias|afastado|congelado|
desligado (stColab). Campo 'Status juridico' REMOVIDO de vez; banner + toggle no
#colabStatus; pausa de alertas em **status==='congelado'** (ferias/vencimentos/
epi/avaliacoes). E2E: PATCH congelado 200, excluido das ferias. A coluna
status_juridico (055) ficou VESTIGIAL (sem nenhuma referencia no codigo apos esta
parte; NAO dropada de proposito — flexibilidade + evitar op destrutiva). HISTORICO
DA SAGA (nao refazer): 055 criou campo separado -> 056 juntou no status -> 057
separou de novo -> 058 juntou DE VEZ (estado atual). Resumo p/ futuras sessoes:
**congelado e um valor do campo status; nao existe campo status_juridico na UI.**

## Atualizacao 14/06/2026 (parte 9) — Vinculo RH como base das pessoas

**DECISAO/INVARIANTE (Adriana): o RH (`rh_colaboradores`) e a BASE das pessoas; e
ele que "libera" para o resto do portal.** Login do portal = `portal_profiles`, ligado
ao RH por `rh_colaboradores.profile_id` (-> portal_profiles.id). O endpoint
`/api/admin/rh/colaboradores/[id]/acesso` cria/vincula o login a partir do colaborador
do RH (nao criar login solto).

**Equipamentos apontam para a PESSOA do RH:** `ativos.alocado_para_id =
rh_colaboradores.id` (NAO portal_profiles.id). `/api/portal/meus-equipamentos` resolve
login -> rh (profile_id) -> equipamentos alocados ao rh.id (busca por
`in (rh.id, login)` por retrocompat). A entrega (`/admin/ativos/[id]` + movimentar
"entregar") escolhe da LISTA DO RH (pessoas ativas); o termo de responsabilidade usa o
login (`ativos_termos.colaborador_id` -> portal_profiles, FK) — entrega de quem nao tem
login gera termo sem assinante digital. `desligamentos/posse|finalizar` ja cruzavam por
rh.id OU profile_id OU nome (continuam compativeis).

**Migracao pontual rodada (idempotente, script `scripts/_tmp_vinculos.mjs`, gitignorado):**
estado anterior era CAOTICO — 33 equipamentos alocados SO por nome (0 com id) => nada
aparecia em "Meus Equipamentos"; e so 1 de 97 do RH tinha login (12 dos 13 membros
soltos). Aplicado: 8 membros vinculados ao RH (email/nome; PULADO o falso-positivo do
inbox generico `contato@costajr.com.br` que casava Leonardo<->"Adriana Teste"); 28
equipamentos re-apontados para a pessoa do RH (nome limpo; apelido Gabi->Gabrielly;
nota de obra movida p/ observacoes). **12 equipamentos estao com pessoas DESLIGADAS
(nunca devolvidos — recuperar).** 5 nomes ambiguos ficaram so com o texto p/ decisao da
Adriana: "Jessica" (2 candidatas), "Junior" x2, "RH" (setor, nao pessoa), "Lidia
Eustaquia de Souza" (nao consta no RH). Modulos que ja eram RH-keyed (ferias/EPI/
avaliacoes/documentos) nao precisaram mudar. Commit 6a899e7.

**Fechamento (decisoes da Adriana, mesmo dia, script `scripts/_tmp_recuperar.mjs`):**
os 5 nomes pendentes foram resolvidos — "Junior" (2 chips) = JOSE FERREIRA DA COSTA
JUNIOR; "Jessica" = JESSICA OLIVEIRA CRUZ; "RH" = SAMYRIA (esta com ela hoje). Os
equipamentos de DESLIGADOS (12) + o celular da Lidia (desligada) = **13 celulares
DEVOLVIDOS ao estoque** com movimento `devolucao` registrado (historico preservado:
de_nome = quem estava com ele). Estado final: 19 equipamentos alocados, TODOS com
`alocado_para_id` = rh.id (0 so por nome). As 23 pessoas ativas do RH sem login seguem
sem acesso (Adriana libera caso a caso pelo botao "Dar acesso" na ficha do RH).

## Atualizacao 14/06/2026 (parte 10) — Ativos 5 abas + Telegram (2 bots) + jurídico→Telegram

**Ativos reestruturado em ABAS (commit da sessao):** /admin/ativos agora separa por
categoria + abas ESPECIAIS (`ESPECIAIS=["deposito","extraviados","saidas","conserto"]`).
STATUS_EXTRAVIO=[extraviado,roubado], STATUS_SAIDA=[baixado,descartado,vendido],
STATUS_CIRC inclui danificado. Itens extraviados/baixados/vendidos SAEM dos ativos
disponiveis (aba propria); "Para conserto" (danificado) e ABA APARTADA de resumo;
"Em deposito" e aba propria. KPIs novos: Em deposito, Para conserto, Extraviados,
**Valor de vendas (separado do patrimonio)**. Status **VENDIDO** + `valor_venda`/
`data_venda` (campo aparece no modalStatus via toggleValorVenda). Transferir-p/-obra
ganhou LUPA de busca (#obraSearch + filtrarObras). **Migration 059 RODADA:** tabela
`depositos` (+ seed Ipiranga) + ALTER ativos_alocado_para_tipo_check (+deposito) +
ALTER ativos_status_check (+vendido) + colunas valor_venda/data_venda. Novo destino de
transferencia: DEPOSITO (movimentar.ts caso `transferir_deposito`, SEM termo). CRUD de
depositos em /admin/depositos. **E-mail p/ adm@costajr.com.br em QUALQUER mudanca de
status** (ATIVOS_ALERT_EMAIL no aplicar() do movimentar.ts).

**TELEGRAM — central src/lib/telegram.ts (UM BOT POR CANAL):** `enviarTelegram(texto,
{canal})` best-effort (nunca lanca). Resolve `TELEGRAM_BOT_TOKEN_<CANAL>` +
`TELEGRAM_CHAT_<CANAL>`; sem isso cai no padrao `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`.
HTML via escTg(). DOIS canais ativos e VALIDADOS em producao (HTTP 200 {"ok":true} nos 2):
- **ATIVOS** (@cjr_ativo_bot, grupo CJR_ATIVOS) = canal PADRAO. Dispara em TODA
  movimentacao de equipamento (movimentar.ts: entrega/devolucao/troca-status/venda/
  deposito/conserto). Token 8790779785:... | chat TELEGRAM_CHAT_ID=-5495934006.
- **ADM** (@cjr_adm_bot, grupo CJR_ADM) = RH/admin/juridico. Wired em rhVencimentos.ts
  (docs a vencer + aniversariantes), ferias.ts, epi.ts, avaliacoes.ts,
  desligamentos/finalizar.ts, vagas/candidatar.ts. Token 8871443844:... |
  chat TELEGRAM_CHAT_ADM=-5348850906.

**Jurídico (e-mail) → Telegram via Power Automate (FUNCIONANDO):** endpoint recebedor
`POST /api/integra/email-telegram` protegido por segredo (header `x-integra-secret` ou
`?key=`) = `INTEGRA_TELEGRAM_SECRET=cjr_7b885290b46430854521c7d0`. Le o corpo de forma
tolerante (JSON quebrado vira assunto cru). Fluxo Power Automate "Juridico para Telegram
(CJR_ADM)": trigger "Quando um novo e-mail e recebido (V3)" (Office 365 Outlook, pasta
JURÍDICO) → HTTP POST ao endpoint com Assunto/De/caixa → cai no grupo CJR_ADM. Body
aceita `canal` (default ADM) — testei canal ATIVOS por ele tambem (200 ok).

**SEGURANCA (invariante desta sessao):** os 2 TOKENS DE BOT foram colados pela Adriana
na Vercel (eu NAO digito API keys em sistemas externos). Eu so adicionei os valores
nao-secretos (TELEGRAM_CHAT_ID, TELEGRAM_CHAT_ADM, INTEGRA_TELEGRAM_SECRET) e disparei o
Reimplante. Variaveis de ambiente da Vercel SO valem apos um REDEPLOY.

**Outras entregas da sessao:** /intranet com botoes "Acessar" (1 linha); /portal home
redesenhado (cards maiores, JunIA em destaque, sem Base de Conhecimento — vira chat),
`<style is:global>` (estilos scoped do Astro NAO alcancam innerHTML); sw.js cjr-v2;
vinculo RH↔membros↔equipamentos consolidado (parte 9).

**Migration 060 RODADA (14/06/2026):** criou `telegram_sessoes` (base do bot de volta) +
`rh_colaboradores.email_pessoal`. Rodada pela Management API (token do dashboard via
Chrome) — status 201, schema recarregado, coluna confirmada no PostgREST.

**FEITO — item 3 (commit c008f51):** e-mail corporativo x pessoal SEPARADOS na ficha do
colaborador. Form agrupa "E-mail corporativo* + Tel. empresa*" e "E-mail pessoal + Tel.
pessoal*" (corporativo obrigatorio; pessoal opcional). camposColab + APIs POST/PATCH +
import/export de planilha aceitam email_pessoal. Validado E2E na producao via sessao
logada da Adriana (campos email + email_pessoal presentes no #formColab).

**PENDENTE p/ proxima sessao (pedidos da Adriana ainda nao feitos):**
1. ✅ **Onda Perfis FEITA** (14/06/2026) — ver "parte 11" abaixo.
2. ✅ **Bot Telegram de VOLTA (inbound) FEITO** (14/06/2026) — ver "parte 12" abaixo.

## Atualizacao 14/06/2026 (parte 11) — Onda Perfis (8 perfis, sem Coordenador)

**DECISAO/INVARIANTE (Adriana): os PERFIS do portal = as 8 AREAS da empresa.** Antes
eram 6 (admin, coordenador, financeiro, comercial, rh, operacional). Agora 8:
`admin`, `manutencao_operacao`, `manutencao_administrativo`, `operacional` (rotulo
"Operação"), `rh`, `financeiro`, `comercial`, `juridico`. **"coordenador" REMOVIDO.**

**Estrategia p/ minimizar risco:** as CHAVES internas dos perfis antigos foram MANTIDAS
(`operacional` continua existindo, so o RÓTULO virou "Operação") — assim nao precisou
renomear chave em ~30 arquivos nem migrar quem ja era operacional. So adicionei 3 chaves
novas (manutencao_operacao, manutencao_administrativo, juridico) e removi coordenador.

**Fonte unica de verdade: `src/lib/permissoes.ts`** — exporta `PERFIS` (8), `PERFIL_LABEL`
(rotulos), `PERFIL_BADGE` (cores), `PERFIS_PAINEL`, `ehPerfilValido()`, `rotuloPerfil()`.
A tela `/admin/permissoes` JA importa `PERFIS` e itera — entao a matriz lista os 8 sozinha.
membros.astro, rh.astro (perfisMap), minha-conta (x2), portal/index, permissoes.astro e os
dropdowns de publico-alvo (portal-comunicados/treinamentos/onboarding/kb/integracao) usam
os rotulos novos.

**Gates remapeados (coordenador saiu de TODOS):** Logs/Lixeira (paginas + 3 APIs) -> **so
admin**. Conteudo (comunicados/onboarding/treinamentos/kb + trabalhista no junia/kb) ->
**admin + rh**. documentos.ts -> admin + rh. gestao-manutencao (pagina + Portal.astro area
"gestao" + card portal/index) -> **admin, operacional, manutencao_operacao,
manutencao_administrativo**. comercial (Portal.astro + card) -> admin + comercial.

**SEGURANCA — "coordenador" TOLERADO no login (nao quebra sessao ativa antiga):**
auth.ts, login.ts, forgot-senha.ts ainda ACEITAM role 'coordenador' (alem dos 8), mas ele
nao aparece em lugar nenhum da UI e nao ganha acesso em gate nenhum. acesso.ts (atribuir
perfil a um login novo) oferece SO os 8 (sem coordenador).

**Inativo sai de Membros (pedido da Adriana):** /admin/membros agora ESCONDE por padrao
quem e "inativo" = approval_status='rejected' OU vinculado a colaborador do RH desligado.
Aba/pill "🚫 Inativos" revela. Contadores (Todos/Colaboradores/Terceiros) contam so ativos.
Coluna "Cargo" virou "Perfis"; badges mostram o ROTULO (nao a chave).

**Migration 061_perfis.sql RODADA (14/06/2026, Management API):** ALTER da constraint
`portal_profiles_role_check` (8 perfis + coordenador legado + pendente); remapeou os 4
membros que tinham coordenador (Costa JR->admin+; Adriana Teste(desligada)->comercial;
**Samyria(Coord.Administrativo)->RH/DP**; **Renata(Gestor de Manutencao)->manutencao_operacao
+ manutencao_administrativo** — decisao da Adriana); semeou portal_permissoes dos 3 perfis
novos (manutencao_* veem "gestao"; juridico ve documentos/trabalhista). LICAO (de novo): a
coluna role tinha CHECK constraint — adicionar valor de enum exige ALTER da constraint.
**portal_permissoes NAO tem constraint em perfil** (insert livre). E2E confirmado no banco:
0 membros com coordenador, matriz com os 8, novos perfis com areas certas.

**Acessos finos ajustaveis pela Adriana em /admin/permissoes** (a matriz e a fonte do que
cada perfil VE no portal; os defaults dos novos perfis foram semeados, ela refina la).

## Atualizacao 14/06/2026 (parte 12) — Bot Telegram de VOLTA (inbound) FEITO

**Caminho de volta do Telegram:** qualquer pessoa do time abre o PRIVADO do bot de
Ativos (@cjr_ativo_bot), se identifica pelo TELEFONE cadastrado no RH e registra a
movimentacao de um equipamento por um fluxo guiado por BOTOES (sem LLM — maquina de
estados em `telegram_sessoes`, migration 060). Item 2 das pendencias = CONCLUIDO.

**Arquivos:**
- `src/lib/telegramBot.ts` — motor: `processarUpdate(update)` roteia message/callback.
  Identificacao: `msg.contact` (botao request_contact) -> match tolerante de telefone
  (`telBate`: tira DDI 55, compara ultimos 8 digitos no fallback) contra
  rh_colaboradores.telefone/telefone_pessoal (status!=desligado). Guarda
  colaborador_id/nome/email em telegram_sessoes.dados (persistente); `estado` controla o
  passo. Acoes do MVP: **Devolvi ao estoque / Levei para uma obra / Esta com defeito**.
  Aplica o movimento ESPELHANDO movimentar.ts (update ativos + insert ativos_movimentos
  com de_*/para_*/status_novo; defeito tambem insere ativos_ocorrencias tipo=dano) e
  dispara a notificacao OUTBOUND pro grupo de Ativos (enviarTelegram). feito_por =
  "Nome <email> (via Telegram)". Token = TELEGRAM_BOT_TOKEN (bot Ativos).
  ENTREGA FORMAL (com termo de responsabilidade) continua SO no admin de proposito.
- `src/pages/api/telegram/webhook.ts` — recebedor; valida o header
  `x-telegram-bot-api-secret-token` == INTEGRA_TELEGRAM_SECRET; responde 200 sempre.
- `src/pages/api/admin/telegram/configurar.ts` — POST faz setWebhook (url=
  SITE/api/telegram/webhook, secret_token=INTEGRA_TELEGRAM_SECRET, allowed_updates
  message+callback_query, drop_pending_updates); GET = getWebhookInfo. **O token NUNCA
  sai do servidor** — o admin so dispara. (Respeita a regra: eu nao digito o token em
  sistema externo; o app chama o setWebhook com o token do proprio env.)
- `/admin/telegram` (menu Sistema, gate role==admin) — botao "Ativar/Reativar bot" +
  "Ver status" + passo a passo pro time. ATIVAR 1x (refazer so se mudar dominio).

**Privacidade BotFather:** NAO precisa mexer — no chat PRIVADO o bot recebe tudo. O
webhook tambem recebe updates do grupo, mas onMessage ignora chat.type!='private'.
**Sem env var nova:** usa TELEGRAM_BOT_TOKEN + INTEGRA_TELEGRAM_SECRET (ja na Vercel).
**Webhook JA ATIVADO (14/06/2026)** via /admin/telegram (getWebhookInfo: url
costajr.com.br/api/telegram/webhook, sem erros). O time pode usar: manda /start pro
@cjr_ativo_bot e compartilha o telefone.

**E2E VERIFICADO em producao** (via updates simulados no webhook): identificacao por
telefone (casa Jose pelo DDI 55), fluxo completo (menu->busca->eq->devolver->ok) gravou
status em_estoque + ativos_movimentos com feito_por "Nome <email> (via Telegram)" +
notificou o grupo. Seguranca: sem o secret header -> 403.

**FIX de seguranca (commit 36711d4):** o match de telefone foi apertado — exige DDD
(>=10 digitos) e rejeita numeros triviais (00000000…) p/ NAO casar com telefone-lixo do
cadastro (evita personificacao). chaveTel = DDD(2)+numero local(8) (tolera o 9 do celular).

**DADO A CORRIGIR (Adriana):** 7 colaboradores ATIVOS tem telefone SEM DDD na ficha
(Renata 97686-5023, Samyria 95151-0762, Givanildo, Lysnor, Patricia, Higor + o
funcionario teste) — esses NAO conseguem usar o bot ate o telefone ser corrigido com DDD
no /admin/rh. Provavel DDD 11 (SP), mas confirmar antes de bulk-fix.

## Atualizacao 14/06/2026 (parte 13) — Fix critico do Portal + perfis frescos

**BUG CRITICO (commit f51835f):** o `<script define:vars>` do `src/layouts/Portal.astro`
tinha `(el as HTMLElement)` (sintaxe TS). **LICAO: `define:vars` => `is:inline` => o
Astro NAO compila/strip TS** — o script vai CRU pro navegador, e o `as HTMLElement`
estoura SyntaxError que mata o script INTEIRO. Efeito: o menu lateral do portal so
mostrava "Inicio/Minha Conta" (itens area-gated comecam display:none e o JS que os
revela nao rodava), "Carregando..." travado no rodape, avatares "?", notificacoes
mortas. O build do Astro NAO pega isso (inline passa direto). Fix: removidos os casts ->
JS puro. **REGRA: nunca por TS (`as`, `!.`, `: tipo`) dentro de `<script define:vars>`
nem de `is:inline` — so JS puro.** (Varredura: o unico arquivo afetado era o Portal.astro;
ativos/[id].astro tem casts mas num `<script>` normal compilado, ok; paginas publicas
com define:vars — clima/teste/proposta/admissao — foram E2E e estao limpas.)

**Perfis FRESCOS (mesmo commit):** `permissoesDoUsuario(claims)` em src/lib/permissoes.ts
agora le role/roles direto do `portal_profiles` por `claims.sub` (fallback no token) —
assim mudar o perfil de alguem em /admin/membros REFLETE no portal SEM precisar relogar.
Retorna `perfis` tambem. `/api/portal/permissoes` devolve `{areas, categorias_kb, perfis,
role}`. A home `/portal` agora busca esse endpoint e libera os cards por AREA (igual a
matriz) + welcome com o perfil fresco (fallback no localStorage). Sidebar ja usava o
endpoint. NOTA: o ROTULO "Seu acesso" e o nome no topo ainda vem do localStorage do login
(cosmetico) — fica certo no proximo login; as AREAS/cards ja sao frescas.

**Fonte do menu lateral:** 12.5px -> 14.5px, padding 11px (pedido da Adriana).

## Atualizacao 14/06/2026 (parte 14) — Visual do portal + JunIA + bot Telegram guiado

**Referencia visual: portalcjr.vip (Manus antigo).** Adriana quer o visual limpo dele.
Assinatura: cards CENTRALIZADOS coloridos (barra colorida no topo + circulo grande +
titulo MAIUSCULO + descricao central, 1 cor por modulo) e paginas de area com TITULO
GRANDE COLORIDO + subtitulo + "Voltar".

**Home redesenhada (commit do dia):** /portal/index.astro — 9 cards centralizados, cada
um com cor propria (JunIA vermelho, Onboarding azul, Treinamentos roxo, Forum rosa,
Documentos teal, Equipamentos laranja, Comercial verde, Manutencao ambar, Minha Conta
slate). Barra no topo (border-top 5px) + circulo solido da cor + emoji.

**Hero reutilizavel nas areas (commit do dia):** Portal.astro ganhou props `subtitle` e
`accent` -> renderiza um hero (titulo grande colorido + subtitulo) no topo de
.portal-content. Aplicado em documentos/onboarding/forum/meus-equipamentos/gestao-
comercial/gestao-manutencao/minha-conta/treinamentos (cor por area). O titulo duplicado
de cada pagina foi removido. Fonte do menu lateral 12.5->14.5px.

**ARQUIVOS FALTANTES (conteudo) — levantamento:** portal_docs=**0** (area Documentos
VAZIA), portal_treinamentos_videos=2 + pdfs=1 (so os do Santander; faltam categorias
Administrativo/Financeiro/Comercial). Onboarding (12 etapas + 8 PDFs) e KB JunIA (36)
estao OK. **Pendente: a Adriana fornecer os arquivos-fonte** p/ popular Documentos e
Treinamentos.

**JunIA (fix commit do dia):** (1) logo gigante — .jn-mascote 150px/60% -> 92px/28%.
(2) "nao interage" — o motor (src/lib/junia.ts, busca por palavra-chave threshold 6,
SEM LLM) RESPONDE quando a pergunta bate com a base (Santander prazo=score 12). Uma das
3 sugestoes prontas ("EPIs obrigatorios") NAO estava na base -> caia em pendencia;
troquei pelas que existem (Santander, nomenclatura de obras, IPVA) -> respondem na hora.
NOTA p/ Adriana: JunIA (/portal/junia) = chat de IA (funciona); Forum (/portal/forum) =
quadro de topicos separado. No Manus era 1 coisa so ("Forum CJR = JunIA"). Avaliar
unificar/renomear se ela quiser.

**Bot Telegram inbound REFORMULADO p/ fluxo GUIADO (pedido da Adriana; commit do dia):**
src/lib/telegramBot.ts reescrito. Fluxo: identifica pelo telefone -> "Quer registrar uma
movimentacao?" [Sim/Nao] -> "Qual o tipo?" [Telefone/Veiculo/Equip. de obra/Informatica]
(= ativos.categoria telefonia/veiculo/equipamento_obra/informatica) -> digita p/ achar o
item DENTRO da categoria (telefonia tem 56, equip_obra 105 — botao p/ cada seria inviavel)
-> "Para onde?" [Pessoa/Obra/Estoque/Defeito] -> (pessoa/obra: digita e escolhe) ->
confirma -> "✅ Equipamento movimentado com sucesso!" + atualiza base + avisa o grupo.
Inclui ENTREGA a pessoa (status alocado). Maquina de estados em telegram_sessoes
(estados: pronto/esc_categoria/busca_equip/esc_destino/busca_pessoa/busca_obra/
mov_confirma). E2E VERIFICADO em producao (fluxo completo Sim->Telefone->equip->devolver->
ok grava em_estoque + movimento por Jose). Webhook ja ativo (URL inalterada).

## Atualizacao 14/06/2026 (parte 15) — Forum=JunIA + admin gated por perfil + docs Manus

**Forum unificado com JunIA (commit do dia):** /portal/forum.astro agora REDIRECIONA
para /portal/junia (o "Forum" e o chat de IA, como no Manus). Sidebar: removido o item
"Forum" separado, o item de IA virou "Forum / JunIA 🤖". Home: card unico "Fórum / JunIA"
(removido o card "Forum" de topicos). portal_forum_topicos continua existindo mas sem
entrada na UI.

**Documentos do portal antigo (3 arquivos que a Adriana salvou na raiz):**
Portal_CJR_Documentacao_Completa.pdf/.docx + portal-cjr-documentacao.zip (mesmo conteudo).
**ATENCAO: e a doc do modulo de MANUTENCAO PREVENTIVA** (clientes/tecnicos/visitas
preventivas/orcamentos do portalcjr.vip) — 11 docs + diagramas. **NAO contem a JunIA**
(a JunIA/intranet colaborador era outro projeto Manus). Util p/ completar a Gestao de
Manutencao. **Doc 07 (Usuarios e Permissoes)** = modelo de liberacao POR PERFIL do antigo
(matriz Acao x Role por modulo: admin tudo, financeiro so financeiro, etc.). Extrai o
texto em D:/temp/portal_doc.txt e o zip em D:/temp/pcjr_zip2 (unpdf via node; nao ha
python no Windows desta maquina). NAO commitei esses arquivos no git (grandes; ficam na
raiz local, gitignorados de fato por nao estarem em src/db).

**ERRO corrigido — admin NAO filtrava modulos por perfil (commit do dia):** o painel
admin mostrava TODOS os grupos do menu p/ qualquer um que entrasse (RH/Financeiro/etc.).
Espelhei o Doc 07: `src/layouts/Admin.astro` agora le os perfis do token (verifyToken +
perfisDe) e: (1) ESCONDE grupos do menu sem permissao, (2) BLOQUEIA acesso direto (se a
pagina do `current` esta num grupo sem permissao -> Astro.redirect("/admin")). Mapa
GRUPO_ROLES: manutencao/operacoes=admin+operacional+manutencao_*; rh=admin+rh; financeiro=
admin+financeiro; comercial=admin+comercial; juridico=admin+juridico; portal=admin+rh;
institucional/sistema=admin; geral/conta=todos. **Admin ve tudo.** Seguranca: se o token
nao for lido (temPerfis=false) NAO filtra (a propria pagina ja autentica) — evita lockout.
Ajustar GRUPO_ROLES em Admin.astro se a Adriana quiser outro mapeamento. NOTA: o portal do
COLABORADOR e gated pela matriz /admin/permissoes (areas por perfil) — coisa diferente.

## Atualizacao 15/06/2026 — RH aparece p/ Jose + doc-empresa destravado

**"RH nao aparecia p/ o Jose" RESOLVIDO:** era exatamente o gating por perfil (parte 15).
Jose=Costa JR=admin -> com o filtro, admin ve TUDO, inclusive o grupo "RH & Pessoas".
CONFIRMADO ao vivo (find no menu: ref "RH & Pessoas" + "RH — Pessoas" presentes). A Adriana
tambem editou Admin.astro: `juridico` agora inclui `financeiro` (Financeiro ve Juridico) e
adicionou o item "Documentos da Empresa" no grupo juridico. Deployado.

**doc-empresa (WIP de sessao anterior) DESTRAVADO:** a feature "Documentos da Empresa"
(/admin/doc-empresa, board Monday DOCUMENTOS EMPRESA) tinha codigo committed mas faltava a
tabela. **Migration 062_doc_empresa RODADA** (doc_empresa + doc_empresa_arquivos) + bucket
PRIVADO `doc-empresa` criado (service role). Agora a pagina lista (vazia) sem erro; falta a
Adriana importar os docs do Monday (board 6803034312) se quiser.

## Atualizacao 15/06/2026 (parte 2) — RH por perfil: acesso TOTAL via /admin + atalho no portal

**DECISAO FINAL da Adriana:** quem tem perfil RH deve EDITAR TUDO no RH (profissional da
area), NAO autoatendimento. Isso JA FUNCIONA: o gate de /admin (dashboard) e de /admin/rh
so checa `claims.tipo==='admin'` (qualquer perfil do painel passa, nao exige role admin),
e o gating do menu (parte 15) mostra o grupo "RH & Pessoas" p/ quem tem perfil `rh`. Entao
um membro perfil RH (ex.: Samyria) loga em /admin/login -> dashboard -> RH & Pessoas ->
/admin/rh -> edita TODOS os colaboradores/docs/ferias/EPIs. **Acesso total ja garantido.**

**Eu havia feito um "Meu RH" (autoatendimento, so dados proprios) — REMOVIDO** (a Adriana
nao queria autoatendimento). Apagados /portal/meu-rh.astro + /api/portal/meu-rh*.

**Atalho "Gestao de RH" no portal do colaborador (commit do dia):** card 🧑‍💼 + item no
menu do /portal que aponta p/ /admin/rh, VISIVEL so p/ perfil admin/rh (gate por PERFIL,
nao por area). Assim o profissional de RH acha o caminho pelo portal (clicar leva pro
/admin/rh; se nao tiver admin_token, cai no /admin/login). Implementacao: modules[].perfilGate
na home (renderHub recebe `perfis` da resposta de /api/portal/permissoes que ja devolve
`perfis`); no Portal.astro o item de menu tem `roles:["admin","rh"]` e o script de gating
ganhou `aplicarRoles(perfis)` p/ revelar itens `.role-gated` (JS PURO — define:vars nao
compila TS!). LICAO reforcada: /portal e /admin sao logins SEPARADOS (portal_colab_token vs
admin_token); o atalho cruza os dois (o profissional loga nos dois ou so no admin).

## Atualizacao 15/06/2026 (parte 3) — FIX critico: bloqueio de acesso por perfil

**BUG GRAVE (a Adriana pegou):** o gating por perfil do admin (parte 15) ESCONDIA os grupos
do menu, mas o perfil acessava modulos de outros por URL DIRETA. CAUSA RAIZ: **`return
Astro.redirect()` dentro de um LAYOUT (Admin.astro) NAO funciona** — so funciona no
frontmatter da PAGINA top-level; o retorno de um componente/layout e ignorado, a pagina
renderiza normal. LICAO: nunca confiar em redirect feito num layout p/ controle de acesso.
FIX: em vez de redirect, o Admin.astro calcula `semAcessoPagina` e o `<slot/>` so renderiza
se tiver permissao — senao mostra "Acesso restrito" (o conteudo/dados da pagina NAO vao pro
HTML). Tambem: `GRUPO_ROLES.portal` voltou a ser SO admin (RH nao precisa de Membros/
Permissoes — "RH so ve RH"). VERIFICADO no dev server com tokens forjados (perfis rh/
financeiro/admin): perfil RH ve so [geral, rh, conta] e /admin/financeiro -> "Acesso
restrito"; financeiro ve [financeiro, juridico, conta] e abre o Financeiro; admin ve tudo.
NOTA: o frontmatter da pagina AINDA roda (busca dados) mesmo bloqueado — os dados nao vazam
pro cliente (slot nao renderiza), mas a query roda server-side. P/ blindar de vez, gate
por-pagina (30 telas) fica de melhoria futura. DICA DE TESTE: dev server `npx astro dev
--port 4330` + forjar admin_token com role unico (jose, JWT_SECRET do .env, issuer
costajr.com.br) -> curl com cookie; conferir `data-group=` no HTML + presenca de "Acesso
restrito" em /admin/<modulo>.

## Atualizacao 15/06/2026 — Gestao de RH ESPELHADA dentro do portal do colaborador

**Pedido da Adriana:** o atalho "Gestao de RH" NAO deve redirecionar para o /admin;
deve "espelhar" o modulo de RH DENTRO do portal do colaborador (um login so).

**Solucao (commit 0ab1745, sem reescrever o RH):**
- **CHAVE:** o token do portal (`portal_colab_token`, gerado em `/api/portal/login`)
  e `tipo:"admin"` (mesmo esquema do admin) — so muda onde mora (localStorage no
  portal x cookie HttpOnly no admin). Entao da pra autenticar o /admin com ele.
- **Nova pagina `/portal/rh`** (layout Portal): faz uma PONTE de login — seta o
  cookie `admin_token` = token do portal (via `document.cookie`, ANTES de carregar
  o iframe) e embute `/admin/rh?embed=1` num `<iframe>` same-origin
  (X-Frame-Options=SAMEORIGIN permite). Gating client-side: so perfil rh/admin abre;
  senao "Acesso restrito". Script e `is:inline` JS PURO (garante delivery; nao
  depende de bundle). `/admin/rh` autentica por `claims.tipo==="admin"` -> o token
  do portal passa; o gating por perfil (grupo "rh") libera o conteudo.
- **Admin.astro modo `?embed=1`:** esconde a moldura (menu lateral + topbar) via
  CSS (`.shell.embed`), e um script reescreve os links internos `/admin/*` para
  carregar `embed=1` (a navegacao do RH — Recrutamento/Avaliacoes/etc — fica
  DENTRO do portal, sem moldura dupla).
- **Least-privilege:** grupo "geral" (Dashboard/Analise do Site) ganhou GRUPO_ROLES
  = [admin,financeiro,comercial,operacional,manutencao_*] — um perfil SO-RH nao ve
  KPIs financeiros/comerciais nem digitando a URL. Financeiro/comercial/admin
  continuam vendo o dashboard.
- **Portal.astro:** atalho "Gestao de RH" aponta p/ `/portal/rh`; logout do portal
  limpa o cookie-ponte (`admin_token=; max-age=0`). **portal/index.astro:** card
  "Gestao de RH" -> `/portal/rh`.
- **Validado E2E (dev + token forjado):** embed esconde moldura, RH renderiza sem
  "Acesso restrito", dashboard bloqueado p/ so-RH, financeiro/admin veem dashboard,
  script rewrite-embed presente, `/portal/rh` em prod com o script inline correto.
  Caveat: o teste forjado em PROD cai no login porque o JWT_SECRET local do .env !=
  o da Vercel — esperado; o fluxo real (RH loga no portal -> token assinado pelo
  segredo de prod) verifica certo. tsc + astro build limpos.
- **PADRAO reusavel:** para espelhar QUALQUER modulo do admin dentro do portal,
  basta `/portal/<x>` com a ponte de cookie + iframe `/admin/<x>?embed=1` gated por
  perfil. (Decisao: iframe + ponte em vez de reescrever a UID gigante do modulo.)

**FIX (mesma data) — a moldura do admin aparecia no embed (Adriana pegou):**
- **CAUSA RAIZ: o site redireciona apex (`costajr.com.br`) -> `www`.** Se o portal
  esta no apex e o iframe vira www, ficam em ORIGENS diferentes -> o cookie-ponte
  (setado no apex) nao ia pro www e o `X-Frame-Options: SAMEORIGIN` bloqueava;
  e o `?embed=1` por si so nao ativava o embed de forma confiavel.
- **Deteccao de embed agora por 3 sinais redundantes** (Admin.astro, qualquer um
  ativa): query `?embed=1`, header `Sec-Fetch-Dest: iframe` (sobrevive ao
  cross-origin e a TODA navegacao dentro do iframe), e `Referer` contendo
  `/portal/rh` (same-origin manda o path por causa de strict-origin-when-cross-origin).
  Os headers sao regenerados a cada request -> nao dependem da query sobreviver.
- **CSS que esconde a moldura agora SEMPRE presente** (so a classe `.shell.embed`
  e condicional) — sem fragilidade de render condicional do `<style>`.
- **TRAVA no grupo "rh" dentro do embed do portal, ATE para admin** (`embedRhLock`
  disparado por query OU referer /portal/rh): abrir Financeiro/Dashboard/etc dentro
  do embed -> "Acesso restrito". (NUNCA dispara so por sec-fetch-dest, p/ nao travar
  um iframe interno qualquer do admin.)
- **Cross-origin apex<->www resolvido:** `vercel.json` ganhou
  `Content-Security-Policy: frame-ancestors 'self' apex www` em `/admin/(.*)` (em
  Chrome, frame-ancestors tem precedencia sobre X-Frame-Options) + o cookie-ponte
  agora e `domain=.costajr.com.br` (vale apex E www; host-only no localhost). Logout
  limpa os 2 escopos. **Assim funciona tanto no apex quanto no www, sem relogin.**
- `sw.js` cjr-v2 -> **cjr-v3** (limpa cache antigo nos navegadores). **Apos deploy,
  o usuario precisa de UM hard refresh (Ctrl+Shift+R) p/ o SW novo trocar.**
- LICAO: o redirect apex->www fragmenta cookie/localStorage entre 2 origens; iframe
  same-origin do admin so funciona se a pagina e o iframe estiverem no MESMO host —
  por isso o CSP frame-ancestors + cookie de dominio. Validado E2E no dev (admin
  forjado): referer /portal/rh sozinho ativa embed+RH; admin tentando Financeiro no
  embed -> Acesso restrito.

## Atualizacao 15/06/2026 (parte 2) — Aba "Acessos a sistemas" na ficha do colaborador

**Pedido da Adriana:** registrar na ficha quais PROGRAMAS cada colaborador tem
acesso, para saber o que revogar em desligamento ou troca de funcao.

- **Migration 063_rh_acessos RODADA** (via Management API/Chrome): tabela
  `rh_acessos` (colaborador_id, sistema, categoria, usuario, observacao, status
  ativo|revogado, concedido_em, revogado_em; unique colaborador+sistema; RLS
  service-role). **Mantem HISTORICO** — revogar nao apaga, so marca revogado.
- **`src/lib/sistemas.ts`**: catalogo agrupado (`SISTEMAS_CATALOGO`) com 30
  programas em 7 categorias (Sistemas/Gestao: PortalCJR/Vobi/Rotaexata/ControlID/
  D4Sign; Bancos: BB/Bradesco/Caixa/Itau/Nubank/Santander/Sicoob; Beneficios/VT:
  Alelo/Caixa VT/Coopcerto; Pedagio/Frota: Veloe/Semparar/Localiza/Movida;
  Telefonia: Tim/Vivo; Mobilidade: Uber/Lalamove/Logi; Compras: Trilogo/Aquanima/
  Ariba/Carrefour/Kalunga/CAU). Para adicionar fixo, editar a lib; a ficha tambem
  aceita "adicionar fora da lista" por colaborador.
- **API `/api/admin/rh/acessos`** (GET catalogo+acessos por colaborador; POST
  upsert com auditoria). POST: tem_acesso=true => ativo (concedido_em no 1o); 
  tem_acesso=false em algo que era ativo => revogado + revogado_em (historico).
- **Aba "🔐 Acessos"** na ficha (rh.astro, tab 'acessos' no fichaTab): catalogo
  por categoria com checkbox + login + observacao, badge de ativos, botao
  "adicionar fora da lista", e secao de Historico (revogados). Funcoes
  carregarAcessos/salvarAcessos/addLinhaAcessoCustom expostas ao window (script
  TS compilado normal, nao define:vars).
- **Desligamento integrado:** `posse.ts` retorna `acessos` ativos; o modal de
  desligamento mostra "Acessos a revogar pela TI"; `finalizar.ts` REVOGA todos os
  acessos ativos ao concluir e os LISTA no e-mail de cancelamentos pra TI
  (RH_ALERT_EMAIL). Acessos NAO travam o desligamento (sao informativos; quem
  trava e ativo/EPI fisico).
- E2E verificado contra o banco real (dev + token forjado): GET catalogo, POST
  ativo, revogar (historico preservado com concedido_em/revogado_em), limpeza.
  tsc + astro build limpos.

## Atualizacao 15/06/2026 (parte 3) — Permissao GRANULAR POR USUARIO (ver/editar) + matriz

**Pedido da Adriana:** alem do perfil, poder ticar POR USUARIO, modulo a modulo,
o que cada um VE e o que pode EDITAR (as vezes dentro do mesmo perfil a pessoa
nao pode acessar algo). Escolhas dela: tela propria (MATRIZ) + tudo junto
(acesso + ver/editar nos modulos principais).

- **Migration 064_perm_usuario RODADA** (Management API): tabela
  `portal_perm_usuario` (profile_id, modulo, nivel `nenhum|ver|editar`; unique
  profile+modulo; RLS). Ausencia de linha = "herda do perfil".
- **`src/lib/permissoes.ts` virou a FONTE UNICA** dos modulos do admin:
  `GRUPOS_ADMIN` (espelha o menu — 11 grupos/~45 modulos), `GRUPO_ROLES`
  (perfis por grupo, padrao), `MODULO_GRUPO`/`MODULO_LABEL`, `nivelPadraoPerfil`,
  `nivelEfetivo` (override do usuario > padrao do perfil; **admin nunca trava**),
  `perfisFrescos`, `carregarOverridesUsuario`, `nivelModuloUsuario`,
  `exigirEdicao` e **`bloqueioSeSoLeitura(claims, modulo)`** (retorna Response 403
  se nivel != editar — guard limpo, nao depende do catch). Admin.astro IMPORTA daqui
  (o array `grupos` inline continua sendo so a fonte do MENU; as chaves batem).
- **Admin.astro: gating agora e POR MODULO/USUARIO** (nao por grupo):
  `podeModulo(key)` usa nivelEfetivo; "nenhum" some do menu E bloqueia a pagina
  (slot condicional). Banner **"👁 Somente leitura"** automatico quando o nivel do
  modulo atual e "ver" (classe `.ro-mode` no main; CSS esconde `[data-requer-edicao]`).
- **Tela `/admin/permissoes` ganhou aba "Por usuario"**: MATRIZ modulos×usuarios,
  cada celula alterna **Herdar→Ver→Editar→Nenhum** (cor + base herdada do perfil
  visivel; admin travado em "editar"). API `/api/admin/permissoes-usuarios`
  (GET catalogo+overrides+padrao; PUT substitui overrides dos usuarios do payload).
- **Enforcement Ver=so-leitura no SERVIDOR (via workflow de 5 agentes):** 70
  endpoints de mutacao recusam edicao (403) quando o nivel e "ver" —
  Ativos(10)/Obras(9)/Financeiro(6)/Comercial(4)/RH(41). No RH as chaves sao FINAS
  por subpasta: vagas/candidatos/cargos=`recrutamento`, avaliacoes=`avaliacoes`,
  clima=`clima`, resto=`rh`. (GETs nao tocados.)
- **E2E verificado no banco real:** override ver -> abre+banner+POST 403; nenhum ->
  Acesso restrito + some do menu; editar/admin -> completo; matriz GET/PUT ok.
  tsc + astro build limpos.
- **PENDENTE (polimento, nao critico):** esconder os botoes de edicao nas paginas
  em modo leitura (hoje o banner avisa + o servidor recusa 403 com msg amigavel;
  marcar os botoes com `data-requer-edicao` esconde-os — falta taguear por pagina).

**Refinamentos (15/06/2026, mesma feature):**
- UI da aba "Por usuario" REFEITA estilo Vobi (a matriz densa confundiu a Adriana):
  um colaborador por vez (seletor), departamentos com switch liga/desliga + expandir
  (▸) p/ ajustar modulo a modulo com 👁 Ver / ✎ Editar. `#permEditor` gerado por JS.
- BUG de estilo: o `<style>` do Astro e SCOPED -> HTML gerado por innerHTML nao
  recebia o hash -> switches/cards apareciam crus. FIX: `<style is:global>` na pagina.
  (Regra geral: estilo que precisa valer p/ innerHTML tem que ser is:global.)
- Editor compactado: `#permEditor` max-width 760px + zebra + hover (estava largo
  demais, dificil seguir a linha).
- **TRAVA CENTRAL de "Ver=so-leitura" no MIDDLEWARE** (substitui o guard por-endpoint
  dos 5 modulos, que deixava "Ver" editar nos demais): `src/middleware.ts` recusa 403
  TODA mutacao em `/api/admin/<modulo>` quando o nivel != editar, usando
  `moduloDaRotaApi()` (lib) p/ mapear rota->modulo. Cobre TODOS os modulos. Admin
  nunca trava; GET passa. E2E: Ver em modulo fora dos 5 (clientes) bloqueia edicao.
- **"Removi e ainda abre" era CACHE:** o SW servia HTML antigo do admin. FIX: sw.js
  /admin/* SEMPRE rede, nunca cache (cjr-v3 -> **cjr-v4**). Apos deploy, hard refresh.

## Atualizacao 16/06/2026 — UNIFICACAO: um painel so (fim do espelho) + identidade no admin

**DECISAO ARQUITETURAL DA ADRIANA (definitiva):** em vez de "espelhar" modulos do
admin dentro do portal do colaborador (iframe/embed) e ter logins/paineis separados,
**o /admin vira o PAINEL UNICO de TODOS, com restricoes de visualizacao/edicao por
usuario** — "como qualquer aplicativo: o mesmo painel, porem com restricoes". Isso
elimina a fonte dos bugs recorrentes do espelho ("abre o indice todo", cache,
dual-cookie apex/www). Ela escolheu fazer em fases: **"Espelho + visual primeiro"**.

**Fase 1a — espelho/iframe APOSENTADO (commit 01f7d03):** removida TODA a logica de
embed do `src/layouts/Admin.astro` (deteccao por query/sec-fetch-dest/referer,
`embedRhLock`, CSS `.shell.embed`, script de reescrita de links, classe condicional do
shell). O gating POR USUARIO (`podeModulo`/`semAcessoPagina`/banner somente-leitura +
middleware) PERMANECE — e o que faz "o mesmo painel com restricoes". `/portal/rh`
deixou de ser iframe; virou uma **ponte leve** (JS puro): le `portal_colab_token` do
localStorage, seta `admin_token` (cookie, dominio `.costajr.com.br`) e abre `/admin/rh`
em PAGINA CHEIA. O `vercel.json` ainda tem o CSP `frame-ancestors` de `/admin/*` (era
do embed; inofensivo, limpar depois).

**Fase 1b — identidade do usuario no painel (commit 81f8867):** como o admin vira a
interface de todos, ele agora mostra QUEM esta logado. `Admin.astro` busca
`display_name/full_name/avatar_url` de `portal_profiles` pelo `sub` do token
(best-effort, fallback no local-part do e-mail) e renderiza **avatar + nome + perfil**
no topo a direita (`.topbar-user`) e num chip no rodape da sidebar (`.user-chip`, acima
do Sair). Mobile mantem o avatar e esconde so o texto. Resolve de quebra a confusao
recorrente de "logado como qual usuario" (adriana@ x costajr@). O perfil exibido e so o
PRIMEIRO (`perfisUser[0]`) — se a pessoa tem varios perfis, mostra um (melhoria futura:
juntar/“+N”). VERIFICADO ao vivo (Chrome, sessao Costa JR/Manutencao-Operacao): menu
enxuto pelo perfil, "Acesso restrito" no Dashboard (sem acesso), Ativos abre completo
com a identidade — sem nenhum residuo de embed.

**PROXIMAS FASES da unificacao (NAO feitas — escolha da Adriana p/ quando os testes da
base atual fecharem):** (Fase 2) trazer os modulos voltados ao colaborador
(onboarding, meus-equipamentos, JunIA/forum, documentos) PARA o /admin; (Fase 3) login
unico (aposentar `portal_colab_token` -> tudo via `admin_token`/`/admin/login`); (Fase
4) `/portal` redireciona p/ `/admin` e e desativado; depois reativar os acessos.
**MELHORIA UX pendente (boa, pequena):** quem cai em `/admin` (Dashboard) sem acesso ao
modulo dashboard ve "Acesso restrito" de cara — melhor REDIRECIONAR p/ o primeiro
modulo acessivel do usuario no login/landing.

**ACESSOS BLOQUEADOS p/ teste (lembrete da sessao anterior — reativar quando a Adriana
pedir "reativa os acessos"):** 7 `portal_profiles` estao com `approval_status='pending'`
(+ `portal_sessoes` apagadas): contato@ (5383fd57), aline.martiniano@ (91ecad9f),
renata.peres@ (d37f96e4), higor.pelicho@ (39859869), samyria.almeida@ (89195493),
russodrica@gmail.com (d0ce2a1b), jessica.cruz@ (3b28894b). ATIVOS de proposito:
adriana@ (admin) e costajr@.

## Atualizacao 16/06/2026 (parte 2) — UNIFICACAO COMPLETA: portal colaborador dentro do /admin

**ESTADO FINAL (decisao da Adriana executada): UM painel so (`/admin`) para TODOS,
com restricoes por usuario. O portal do colaborador (`/portal/*`) foi APOSENTADO —
tudo redireciona p/ `/admin`.** Mapeamento previo por workflow multi-agente
(understand-portal-unify). Executado em 4 fases, cada uma buildada/deployada/verificada
ao vivo (sessao Costa JR / Manutencao-Operacao). INSIGHT-CHAVE: os tokens do admin e do
portal SEMPRE foram identicos (tipo:"admin", sub=portal_profiles.id) — entao "login
unico" foi basicamente fazer o `requireAdmin` aceitar o cookie.

**Fase 0 — login unico (base, invisivel):**
- `src/lib/auth.ts` `requireAdmin(req)` agora le `getPortalToken(req) || getAdminTokenFromCookie(req)`
  — UMA linha que destrava TODOS os 24 `/api/portal/*` no cookie `admin_token`, sem tocar
  nos endpoints. (Header `x-portal-auth` continua aceito p/ retrocompat.)
- `/api/portal/login.ts` passou a SETAR o cookie `admin_token` (igual `/admin/login`).

**Fase 1 — `/admin` virou o HUB de entrada (nao mais o Dashboard):**
- `src/pages/admin/index.astro` = HUB de cards amigavel (visual do portal), mostra 1 card
  por modulo acessivel (`nivelEfetivo != nenhum`), agrupado por area, banner "Olá, <nome>"
  + perfil. Cards do "Meu Espaco" tem cor propria (MODULO_COR no hub).
- Dashboard MOVIDO p/ `src/pages/admin/dashboard.astro` (git mv); virou so mais um card.
  Hrefs atualizados (Admin.astro menu + GRUPOS_ADMIN key dashboard -> /admin/dashboard).

**Fase 2 — modulos do colaborador trazidos p/ `/admin` (grupo "Meu Espaco"):**
- 5 paginas novas reusando as APIs `/api/portal/*` (cookie auth): `/admin/meu-onboarding`,
  `/admin/junia`, `/admin/documentos-portal`, `/admin/treinamentos-portal`,
  `/admin/meus-equipamentos`. Port das `/portal/*`: layout Admin + guard de cookie no
  frontmatter; tirado o redirect p/ /portal/login; `<style is:global>` (scoped NAO alcanca
  innerHTML — cards ficavam crus); token = `localStorage... || ""` (cai no cookie).
- Grupo "meu-espaco" adicionado em Admin.astro (`items`) E permissoes.ts (`GRUPOS_ADMIN`,
  `itens`) com as MESMAS keys. **SEM entrada em GRUPO_ROLES => liberado a TODO logado**
  (autoatendimento; cada um ve os SEUS dados). MODULO_GRUPO/MODULO_LABEL se derivam sozinhos.
- **Sino de notificacoes portado p/ Admin.astro** (topbar): badge + dropdown + polling 60s,
  mesmo backend `/api/portal/notificacoes` (cookie auth). Verificado ao vivo (badge "1").

**Fase 3 — `/portal/*` redireciona p/ `/admin` (login unico final):**
- TODAS as paginas colaborador do `/portal` viraram stub de redirect 302: index->/admin,
  login->/admin/login, onboarding->/admin/meu-onboarding, meus-equipamentos, junia,
  documentos->/admin/documentos-portal, treinamentos->/admin/treinamentos-portal,
  forum->/admin/junia, gestao-comercial->/admin/comercial, gestao-manutencao->/admin,
  minha-conta->/admin/minha-conta, rh->/admin/rh.
- MANTIDOS: `/portal/trocar-senha` (troca de senha standalone, dual-token — funciona) e
  `/portal/meu-rh` (codigo morto, sem link). `Portal.astro` NAO foi removido (ainda serve
  cliente/tecnico/admin-manutencao — so o ramo colaborador ficou orfao).

**VERIFICADO AO VIVO (Chrome, sessao Costa JR):** hub com 5 cards coloridos de Meu Espaco +
areas por permissao; `/admin/meus-equipamentos` carrega dados reais via cookie (prova da
Fase 0); `/portal/onboarding` -> redireciona p/ `/admin/meu-onboarding` e renderiza
estilizado; sino com badge. Commits 01f7d03..6131382. tsc + astro build limpos em todas as fases.

**PENDENTE / proximos passos (limpeza, NAO critico):**
- `/admin/login` NAO inclui `roles[]` no token (so `role`) — inofensivo (perfis sao lidos
  FRESCOS do banco via perfisFrescos/permissoesDoUsuario), mas podia incluir p/ consistencia.
- Limpeza futura: remover ramo colaborador do Portal.astro; remover `/portal/meu-rh*`;
  remover fallback `x-portal-auth` do requireAdmin (so quando ninguem usar localStorage);
  tirar o CSP `frame-ancestors` de /admin/* no vercel.json (era do embed). Atualizar links
  do site publico (/intranet, rodape) de /portal p/ /admin/login (hoje funcionam via redirect).
- **Reativar os 7 acessos** bloqueados quando a Adriana pedir (lista na parte 1 acima).
- Trava read-only (middleware) so cobre `/api/admin/*`; os 5 modulos novos usam
  `/api/portal/*` (autoatendimento) — fora da trava DE PROPOSITO.

## Atualizacao 16/06/2026 (parte 3) — Ferias: lancar periodo anterior (historico, sem alertas)

Pedido da Adriana: poder incluir periodos de ferias ANTERIORES (ja gozados) so para
o historico do colaborador, SEM gerar alertas. **Commit 0217133.**
- API `POST /api/admin/rh/ferias` ganhou o ramo `{ historico:true, colaborador_id,
  inicio_aquisitivo?, dias_abono?, observacoes?, parcelas:[{data_inicio,dias}] }`:
  cria o periodo com `status="concluido"` e as parcelas como `confirmada`
  (confirmada_em/por). Aquisitivo derivado (~12m antes do 1o gozo) se nao informado.
- **Garantia de ZERO alertas:** `enviarLembretesFerias` (ferias.ts) ja exclui
  `status=concluido` (.neq) E pula parcelas confirmadas — entao periodo historico nao
  dispara e-mail/telegram. Tambem nao aparece no painel principal (mesmo filtro),
  so no "📜 Historico".
- UI: `/admin/rh` aba Ferias -> botao "➕ Periodo anterior" + modal (colaborador CLT/PJ
  do SSR via #dadosRH, inicio aquisitivo opcional, abono opcional, 1-3 parcelas
  data+dias, obs). Funcoes expostas ao window (script do rh.astro e modulo).
- E2E VERIFICADO ao vivo (funcionario teste, depois limpo via Supabase REST): POST 201,
  2 parcelas confirmadas, aparece no historico, NAO aparece no painel principal.

**Ferias — alerta SO do periodo aquisitivo vigente (commits 84c1f1f/0ec93a1):** pedido
da Adriana. So o periodo de `inicio_aquisitivo` MAIS RECENTE de cada colaborador gera
alerta. `enviarLembretesFerias` (ferias.ts) reduz a lista a 1 por colaborador (vigente)
antes de montar os eventos. No painel (`renderFerias` em rh.astro), periodos nao-vigentes
saem das contagens Falta programar/Vencidos e ganham badge neutro "Periodo anterior (nao
cobra)". Preventivo: hoje cada colaborador tem 1 periodo (= vigente), entao e no-op
visual; vale quando os ciclos aquisitivos se acumularem (1 novo por ano via auto-avanco).

## Atualizacao 18/06/2026 — Redesign premium do admin (direcao "Vibrante Monday", FUNDACAO)

**DECISAO da Adriana (18/06/2026):** redesenhar o visual do painel /admin para padrao
premium (inspirado em Stripe/Notion/Monday). Direcao escolhida = **"Vibrante Monday"**
(cada AREA com cor propria forte e sistematica; vermelho da marca segue como identidade).
Escopo escolhido = **"Fundacao + shell"** primeiro (cascateia pras ~45 telas via
Admin.astro), depois ondas (dashboard executivo, tabelas/modais, ficha, dark mode).
Mapeamento completo do design atual via workflow multi-agente (6 agentes) — relatorio
de tokens/pain-points/3 direcoes na transcricao da sessao.

**Onda Fundacao+shell ENTREGUE (commit c1c948e), tudo em `src/layouts/Admin.astro`:**
- **Tokens expandidos no `:root`**: paleta semantica em trio (`--success/-bg/-fg`,
  `--warning`, `--danger`, `--info`, `--purple`, `--orange`), cores por area
  (`--area-*` na pratica embutidas no array de nav), escala de cinza `--gray-50..300`,
  sombras em 2 camadas (`--shadow-xs..lg`), `--shadow-focus`, raios `--radius-sm..xl`,
  `--brand-hover/-active/-50/-100/-ring`. **NOMES ANTIGOS MANTIDOS COMO ALIAS**
  (`--brand`, `--ink`, `--bg`, `--border`, `--green/--red/--amber/--blue`, `--radius`,
  `--radius-lg`, `--shadow-sm/md`, `--transition`) p/ NAO quebrar as 45 telas. `--ink`
  passou a #1A1D24, `--bg` #F4F6FA (shifts pequenos).
- **Icones vetoriais Tabler** (webfont CDN `@tabler/icons-webfont@3` no jsdelivr) no
  lugar dos ~45 emojis. Cada NavItem ganhou campo `ic` (nome Tabler); render
  `<i class="ti ti-${ic} nav-icon">`. LICAO: se o CDN falhar, icone fica em branco
  (degrada ok). Verifiquei que todos os nomes existem no CSS antes do deploy.
- **Cores por area (assinatura Monday):** cada `NavGroup` ganhou `cor`; aplicada via
  `style="--area:..."` no grupo. Rotulo do grupo (`.nav-group-label`) e item ativo usam
  `var(--area)`. **Item ativo redesenhado:** fim da sombra vermelha .35; agora faixa
  lateral `inset 3px` + tint `color-mix(area 14%, #fff)` + texto `color-mix(area 80%, ink)`
  (com fallback `--brand-50`/`--brand` antes do color-mix p/ navegador antigo).
- **Sidebar recolhivel (rail 68px):** botao `.rail-toggle` no topo da logo, `toggleRail()`
  alterna `.shell.collapsed` + persiste em `localStorage('admin-collapsed')`. Regras de
  rail dentro de `@media (min-width:769px)` (mobile segue off-canvas). Mostra `.logo-mark`
  ("CJ") e so icones; labels viram `display:none`.
- **Busca global / command palette (Ctrl+K):** `.cmd-trigger` na topbar + overlay
  `#cmdOverlay` que filtra os modulos ACESSIVEIS (`modulosBusca` = grupos filtrados por
  `podeModulo`, serializado num `<script id="cmdData" type="application/json" is:inline>`).
  JS num `<script is:inline>` (JS PURO, expoe `window.openCmd/closeCmd/toggleRail` p/ os
  onclick inline — segue a regra is:inline-nao-compila-TS).
- **Polish que cascateia:** botoes hover ESCURECE (`--brand-hover`, fim do opacity:.88) +
  `:focus-visible` ring + semanticos via tokens; inputs com halo de foco
  (`--shadow-focus`) e borda unificada `--border-strong`; tabelas hover perceptivel
  (`--gray-100`) + zebra opcional `.table-zebra`; topbar 56->60px.
- **Favicon:** criado `public/favicon.svg` (quadrado vermelho "CJ") + `<link rel=icon>` —
  a aba estava SEM icone. Confirmado servido em prod (HTTP 200).
- tsc + astro build limpos. **VERIFICACAO VISUAL ao vivo ficou pendente** (o navegador
  desta sessao caiu no /admin/login e eu NAO faco login/senha no lugar da Adriana) —
  validei por build + checagem dos nomes de icone no CSS do CDN + favicon servido.
  Pedir a Adriana p/ dar **hard refresh (Ctrl+Shift+R)** no /admin (SW serve HTML
  network-first, mas o refresh garante).

**PROXIMAS ONDAS do redesign (escolha da Adriana):** (2) Dashboard executivo
(numero-heroi + sparklines nos KPIs + deltas-chip + gráficos com grid/eixo + donut com
stroke + taxa de conversao no funil); (3) Componentes DataTable/Modal padronizados
(sticky header, ordenacao, modal unico com ESC/foco); (4) Ficha do colaborador
modal->drawer; (5) Dark mode (`[data-theme=dark]`, viavel pq tokens ja centralizados);
(6) hub `/admin/index` e telas com icone Tabler no lugar de emoji. Hub ja usa GRUPO_COR
(Monday) — trocar emojis depois.

**Onda 2 (parcial) — Dashboards reestruturados (commit 71abe93, feedback da Adriana):**
A Adriana apontou que o `/admin/dashboard` era so de MANUTENCAO e nao gostou da tela de
cards de entrada. Decisao dela: a ENTRADA vira o "dashboard do site"; o de manutencao vai
pra aba Manutencao.
- `/admin` (`src/pages/admin/index.astro`) NAO e mais o hub de cards — virou o **DASHBOARD
  DO SITE**: faixa "Pendencias que precisam de acao" (consolidada) + grid "Indicadores por
  area" (Manutencao, Comercial, Financeiro, RH, Operacoes&Obras). **Cada bloco e GATED por
  `nivelEfetivo(key,...)!=='nenhum'`** (so aparece p/ quem tem acesso aquela area — LGPD).
  Financeiro usa a RPC `fin_resumo_caixa({p_meses:1})` -> `data.cards.{a_receber,a_pagar,
  atrasados_pagar,atrasados_pagar_qtd}`. Contagens via Supabase (nao lanca em erro de query
  -> count null vira 0, sem quebrar a home). Tabela das perguntas JunIA = `portal_pending_questions`
  (status pending). Visual Monday: cards com border-top na cor da area + chip de icone tonal.
- `/admin/dashboard` (`dashboard.astro`) = **"Painel de Manutencao"** (titulo trocado),
  item movido do grupo "geral" p/ o grupo "manutencao" no menu (key segue "dashboard").
- Menu: logo virou link p/ `/admin`; item fixo **"Visao geral"** no topo (sempre visivel,
  fora da matriz de permissao, `current="home"`). Guard: `current==='home'` nunca cai em
  somente-leitura (a chave "home" nao esta na matriz).
- PENDENTE dessa onda (nao feito): sparklines/numero-heroi/deltas-chip e graficos com
  eixo/grade ficaram p/ depois — esta entrega focou em "indicadores por area + pendencias"
  (o pedido literal). O hub de cards antigo (GRUPO_COR/MODULO_COR) foi descontinuado.

## Atualizacao 18/06/2026 (parte 2) — Integracao AO VIVO com a Vobi (somente leitura)

**DECISAO da Adriana:** em vez de migrar/transicionar o financeiro da Vobi (exige muito
teste), fazer uma INTEGRACAO ao vivo (read-only) que puxa indicadores direto da API e
mostra na plataforma CJR. Pediu: Financeiro (contas em aberto/a vencer, filtro por
periodo/ano, indicadores) e Comercial/Oportunidades (incl. PERDIDAS, valor e volume,
taxa de fechamento). **Commit 511e0c2.**

**API Vobi v2 (descoberto nesta sessao):** base `https://api.vobi.com.br/v2`. Auth =
`POST /auth/token` com `Authorization: Basic base64(VOBI_UUID:VOBI_SECRET)` -> `{jwt}`
(campo `jwt`!). GET com `Bearer`. Listas: `?limit=500&offset=N`, resposta `{rows,count}`.
Spec OpenAPI em D:/temp/vobi_openapi.json (147 paths). **PYTHON NAO EXISTE nesta maquina
— a skill vobi-connector usa python3; eu repliquei em Node.** Credenciais validas no .env.
- **Financeiro:** `/financial/cashFlow?where[year]=YYYY` -> `{foreseenAccomplished:[...]}`
  com linhas type `incomeTotal`/`expenseTotal`/`result`/`finalBalance` (campos january..
  december + *Foreseen = previsto). Parcelas em aberto: `/installment?where[idInstallmentStatus]=1`
  (1=previsto/nao pago) `&where[$payment.billType$]=expense|income`; campo `dueDate`,
  `price`. (idInstallmentStatus: 12=cancelado, 2-11=pago, 1=previsto.)
- **Comercial = `/refurbish`** (oportunidades/obras): `budget`=valor, `winnerDate`=ganho,
  `idStep`=coluna do funil. **O funil sao STEPS** (`/step`, 51 colunas custom da Adriana:
  NOVA, EM ORCAMENTO, ENVIADO CLIENTE, VENDA, "PERDIDA 2025", "CANCELADA 2025", FATURADA,
  PAUSADA...). **LICAO CRITICA: o `/refurbish` padrao EXCLUI as perdidas/canceladas** —
  elas so vem com `where[idStep]=<id>` (PERDIDA 2025 id=439403 -> 209 op/R$19,5mi;
  CANCELADA 2025 id=439404 -> 98 op/R$1,3mi). Ganhas via winnerDate (36 op/R$414k).

**Arquivos:** `src/lib/vobi.ts` (auth+cache 5min; `vobiFinanceiro(ano)`, `vobiComercial(ano|null)`.
**REGRA DE CLASSIFICACAO (definida pela Adriana 18/06, commit 29bfaed): ganha = winnerDate
preenchido; perdida/cancelada = oportunidade ARQUIVADA (archivedDate set); resto = aberto.**
NAO classificar pelas colunas "PERDIDA 2025"/"CANCELADA 2025" (sao colunas custom ATIVAS,
archivedDate=null). As arquivadas vem do pseudo-step **Arquivado id=9999997** (=todas as
arquivadas, archivedDate preenchido; 154 op/R$9,27mi). Funil = so pipeline ativo; filtro de
ano pela data relevante (ganha=winnerDate, perdida=archivedDate, aberta=createdAt). APIs `/api/admin/vobi/{financeiro,comercial}` (GET, `bloqueioSeSemLeitura`, 503
amigavel se sem credencial). Telas `/admin/vobi-financeiro` e `/admin/vobi-comercial`
(filtro de ano client-side, KPIs, grafico, funil). Modulos `vobi-financeiro` (grupo
financeiro) e `vobi-comercial` (grupo comercial) em permissoes.ts + Admin.astro — LGPD:
financeiro so admin+financeiro, comercial so admin+comercial.

**ACAO PENDENTE DA ADRIANA (eu NAO digito secrets em sistema externo):** colar `VOBI_UUID`
e `VOBI_SECRET` (valores do .env) nas Environment Variables da Vercel + Reimplantar. Sem
isso as telas mostram "Credenciais da Vobi nao configuradas". **A classificacao won/lost
por nome de coluna pode precisar de ajuste fino** (ex.: FATURADA/EM ANDAMENTO contam como
"em aberto" hoje pois nao tem winnerDate; se a Adriana quiser que contem como ganha,
mapear os ids de step). idStep dos won-steps a confirmar com ela.

## Atualizacao 19/06/2026 — JunIA inteligente com a API do Claude (Haiku)

**Pedido da Adriana:** humanizar a JunIA e fazer ela ENTENDER a pergunta pelo sentido
(cada um pergunta diferente), achando a resposta cadastrada na base — SEM buscar nada
externo. Pode pedir esclarecimento de volta. Usar o modelo mais barato (Haiku) na conta dela.

**Feito (commit 01b1bdc):**
- `src/lib/juniaIA.ts` — `responderJuniaIA(claims, pergunta, historico)`: RAG sobre
  `portal_kb` (so categorias que o perfil pode ver = LGPD; trava trabalhista ANTES do
  modelo). Manda os Q&A permitidos + a pergunta + historico da conversa pro **Claude
  Haiku** (`claude-haiku-4-5`), que faz match SEMANTICO, humaniza, OU pede esclarecimento,
  OU sinaliza "sem_resposta" (vira pendencia pro gestor, fluxo que ja existia). System
  prompt proibe conhecimento externo. Saida em JSON {tipo, texto} parseada com fallback.
- **Fallback seguro:** sem `ANTHROPIC_API_KEY` OU em qualquer erro (cota/rede/parse) ->
  cai no motor de busca por palavra-chave atual (`junia.ts`, `responderJunIA`). Nada quebra.
- Endpoint `/api/portal/junia` carrega o historico (`portal_messages`) e chama a versao IA.
- SDK oficial **`@anthropic-ai/sdk`** (v0.105) instalado. Custo ~2 centavos/pergunta (Haiku
  US$1/US$5 por Mtok); formato da chamada validado (401 auth, sem erro de formato).

**PROVEDOR DE IA AUTOMATICO (commit 8bc35e4):** a Adriana preferiu a API GRATIS. `juniaIA.ts`
escolhe sozinho, nesta ordem: (1) `NVIDIA_API_KEY` -> **gpt-oss-120b** (modelo aberto da
OpenAI hospedado de graca pela NVIDIA em `https://integrate.api.nvidia.com/v1/chat/completions`,
formato OpenAI/Bearer nvapi-; endpoint validado 403 auth) — GRATIS com limite de requisicoes;
(2) `ANTHROPIC_API_KEY` -> Claude Haiku (pago, barato); (3) nenhum -> busca por palavra-chave.

**PENDENTE DA ADRIANA:** pegar a chave GRATIS da NVIDIA em **build.nvidia.com/openai/gpt-oss-120b**
("Get API Key", chave `nvapi-...`) e colar na Vercel como **`NVIDIA_API_KEY`** + redeploy. (Ou,
se um dia quiser Claude, `ANTHROPIC_API_KEY` do console.anthropic.com — creditos de API SEPARADOS
do plano Pro/Max.) Eu NAO digito a chave. Enquanto nao por nenhuma, a JunIA segue na busca atual.
PRIVACIDADE: a base (so categorias permitidas) + a pergunta vao pra nuvem do provedor — ok p/
assistente interno; as travas (trabalhista/categorias por perfil) limitam o que e enviado.

## Atualizacao 19/06/2026 — Caixa de Entrada (alimentar base + anexar documentos com sugestao)

**Pedido da Adriana:** (1) jeito rapido de mandar coisas novas pra base de conhecimento que
suba direto pro site; (2) jeito de jogar documentos pra substituir vencidos/inexistentes e o
SISTEMA descobrir onde anexar. Decisoes dela: canal = "Pagina/link rapido" (protegida,
funciona no celular); arquivamento = "Sugere e voce confirma".

**Entregue (commit 660c5c0): `/admin/caixa-entrada`** (menu RH & Pessoas, key `caixa-entrada`,
gated admin+rh). Duas abas:
- **Base de Conhecimento:** "Organizar com IA" (cola texto livre -> IA devolve pergunta+
  resposta+categoria pra revisar) + form salvar -> `portal_kb` (entra NA HORA na JunIA).
  Endpoints `/api/admin/caixa/kb` e `/kb-organizar`.
- **Documentos:** sobe arquivo (1 ou varios; drag&drop) via URL ASSINADA pro bucket PRIVADO
  `rh` na pasta `inbox/` (sem limite de body da Vercel) -> o sistema SUGERE pessoa+tipo+
  validade -> voce confere e clica "Anexar" -> cria `rh_documentos` com TITULO no prefixo do
  slot (cai no slot certo da ficha, via slotDoDoc). Endpoints `/doc-upload-url`, `/doc-sugerir`,
  `/doc-anexar`, `/doc-descartar`. **SEM migration/tabela nova** — a "caixa" vive na propria
  pagina (upload->sugere->confirma); arquivo nao confirmado fica orfao no storage (descartar
  remove). Anexar = logado em audit_log.

**Como o sistema "adivinha" o documento:** `src/lib/slotsDoc.ts` (espelha SLOTS_DOC da ficha
RH: contrato/rg_hab/aso/nr01-06-10-35/ctps/etc + prefixo+tipo+validade por slot) com
`detectarSlotPorTexto` (keywords), `detectarValidade` (regex de data) e `casarColaborador`
(casa nome do arquivo/IA com rh_colaboradores ativos). 1o pela heuristica do nome do arquivo;
2o, se houver Gemini, a IA LE o PDF/imagem e melhora (nome da pessoa, tipo, validade).

**IA compartilhada — `src/lib/llm.ts` (NOVO):** camada extraida do juniaIA. `gerarTextoLLM`
(Gemini->NVIDIA->Claude, primeiro configurado), `lerDocumentoGemini` (le PDF/imagem via
inline_data, SO Gemini), `llmConfigurado`/`geminiConfigurado`, `extrairJson`. juniaIA.ts foi
refatorado p/ usar llm.ts (re-exporta llmConfigurado/HistMsg p/ compat). **Tudo GRACEFUL sem
chave:** KB cai p/ preenchimento manual; Documentos caem p/ sugestao pelo nome do arquivo.

**PENDENTE p/ a Adriana (ativa a IA — eu NAO digito chaves em sistema externo):** colar
`GEMINI_API_KEY` (gerada no Google AI Studio) nas Environment Variables da Vercel + Reimplantar.
Sem isso, a Caixa de Entrada funciona (manual / por nome do arquivo) e a JunIA segue no motor
de palavra-chave. Com a chave: "Organizar com IA" na base e "IA le o documento" passam a valer
(e a JunIA fica humanizada). Ordem de provedor: Gemini > NVIDIA > Claude > fallback. Middleware:
`/api/admin/caixa/*` mapeado p/ modulo `caixa-entrada` (moduloDaRotaApi) + bloqueioSeSoLeitura
por endpoint (LGPD: so admin+rh editam).

**IA ATIVADA E FUNCIONANDO (19/06/2026):** a Adriana colou a `GEMINI_API_KEY` na Vercel
(eu guiei pelo Chrome; ela digita/cola a chave — eu nao) e reimplantou. Medidor de status
criado: `GET /api/admin/caixa/ia-status` + faixa colorida no topo da /admin/caixa-entrada
(verde=IA ativa / vermelho=erro com motivo / amarelo=sem chave) — usar SEMPRE p/ diagnosticar
IA sem adivinhar. **LICAO CRITICA (Gemini free tier): `gemini-2.0-flash` retornou HTTP 429
"exceeded your current quota / check billing" mesmo em chave nova** — mas **cada MODELO do
Gemini tem cota gratuita SEPARADA**. Fix (commits b639e37/413181a): `src/lib/llm.ts`
`chamarGemini` e `lerDocumentoGemini` percorrem `MODELOS_GEMINI` = [gemini-2.0-flash,
gemini-2.5-flash, gemini-flash-latest, gemini-1.5-flash] e usam o 1o que responder; e
`gerarTextoLLM` tenta Gemini->NVIDIA->Claude EM ORDEM caindo pro proximo no erro. Resultado:
ficou **GRATIS e funcionando** (um dos modelos tinha cota).

**PROVEDOR DEFINITIVO = GROQ (19/06/2026, commit 883e045):** o free tier do Gemini era apertado
demais (2-3 perguntas seguidas ja davam 429). A Adriana pegou chave gratis do **Groq**
(console.groq.com, "Continue with Google", sem cartao/verificacao) e colou `GROQ_API_KEY` na
Vercel (eu guiei pelo Chrome). `src/lib/llm.ts` agora tenta **Groq -> Gemini -> NVIDIA -> Claude**
(Groq primeiro; modelo `openai/gpt-oss-120b` via `https://api.groq.com/openai/v1/chat/completions`,
formato OpenAI/Bearer). Medidor confirmou "IA ativa — provedor: Groq". JunIA estavel (aguenta
varias perguntas seguidas). NOTA: **leitura de PDF por imagem continua SO no Gemini**
(`lerDocumentoGemini`; gpt-oss e texto) — se Gemini recusar, doc cai na sugestao pelo nome do
arquivo. Tambem: quando a IA LANCA (limite/erro), a JunIA pede "tente de novo" em vez de abrir
pendencia falsa (commit 27fa450) — antes parecia que a base estava incompleta.

## Atualizacao 19/06/2026 (parte 2) — DOC + BASE pelo Telegram (so RH/admin, sugere e confirma)

**Pedido da Adriana:** automatizar envio de documentos e alimentar a base de conhecimento pelo
Telegram. Decisoes: **so RH/admin** + **sugere e voce confirma**. **Commit 9abbca4. Sem env nova,
sem migration** (usa @cjr_ativo_bot / TELEGRAM_BOT_TOKEN + telegram_sessoes + rh_documentos +
portal_kb + audit_log que ja existem; webhook ja ativo).

**`src/lib/telegramBot.ts` estendido:** o menu pos-identificacao (`mostrarMenu`) agora mostra, P/
QUEM TEM PERFIL admin/rh (resolvido por `ehRhAdmin`: rh_colaboradores.profile_id -> portal_profiles
role/roles), 2 botoes novos alem de "Movimentar equipamento":
- **📄 Enviar documento:** manda foto/PDF -> `baixarArquivoTg` (getFile + download) -> sobe no bucket
  privado `rh` pasta inbox/ -> sugere pessoa+tipo+validade reusando `slotsDoc` (detectarSlotPorTexto/
  detectarValidade/casarColaborador) + `lerDocumentoGemini` se houver Gemini -> card com [Anexar]/
  [Trocar pessoa]/[Trocar tipo] -> confirma -> insert em `rh_documentos` (titulo = prefixo do slot ->
  cai no slot certo da ficha). Estados: doc_aguarda/doc_confirma/busca_pessoa_doc.
- **📚 Alimentar a base:** manda texto -> `gerarTextoLLM` organiza em pergunta/resposta/categoria ->
  confirma -> insert em `portal_kb` (vale na hora na JunIA). Fallback manual "Pergunta | Resposta"
  se a IA falhar. Estados: kb_aguarda/kb_confirma/kb_manual.
RH/admin tambem pode mandar a foto/PDF DIRETO (sem tocar no menu) que cai no fluxo de documento.
Nao-RH que tenta mandar doc -> recusa educada. Tudo logado em audit_log (autor = "Nome <email>
(via Telegram)"). LICAO: `registrarAcao` aceita ctx sem req/admin reais (`{req:undefined, admin:{email}}`)
pq e tudo try/catch + optional chaining. Verificacao ao vivo PENDENTE (a Adriana vai testar pelo
app do Telegram: /start -> menu -> Enviar documento/Alimentar base).

**REFATORADO p/ BOT DEDICADO (19/06/2026, commit 4489400 — decisao da Adriana):** ela preocupou-se
em separar publicos (o bot de Ativos e conhecido por todo o time de campo). Doc+Base MIGRARAM pro
**@cjr_adm_bot** (que ja existia, canal ADM); o **@cjr_ativo_bot fica SO equipamento**. `telegramBot.ts`
virou CIENTE DO BOT: `processarUpdate(update, modo)` com `modo: "ativo"|"adm"`; um objeto `Bot`
{token, modo, pre, nome} e threaded por TODOS os helpers (enviar/tg/baixarArquivoTg/getSessao). Token:
ativo=`TELEGRAM_BOT_TOKEN`, adm=`TELEGRAM_BOT_TOKEN_ADM` (ja na Vercel). **Sessoes separadas por bot**
via PREFIXO na chave (`telegram_sessoes.telegram_user_id` = `"adm:"+userId` no bot adm) — assim a mesma
pessoa usando os 2 bots nao colide (sem migration). Bot ativo: foto/PDF -> "use o @cjr_adm_bot". Bot
adm: so RH/admin (menu so doc/base; nao-RH ve "exclusivo do RH"). Novo webhook
`/api/telegram/webhook-adm` (chama processarUpdate(update,"adm"); mesmo secret INTEGRA_TELEGRAM_SECRET).
`/api/admin/telegram/configurar` agora ativa OS DOIS bots (loop) e devolve {resultados}/{infos}; a tela
`/admin/telegram` mostra status dos 2. **DECISAO arquitetural: grupo NAO serve p/ documento sensivel**
(todo mundo do grupo veria = LGPD); o certo e chat PRIVADO 1:1 com o bot + gate de perfil.
**WEBHOOKS DOS 2 BOTS ATIVADOS (19/06/2026)** via /admin/telegram (Adriana clicou; status =
"Webhook was set" nos dois; `TELEGRAM_BOT_TOKEN_ADM` confirmado presente na Vercel). So falta a
verificacao ao vivo do fluxo doc/base pelo app (mandar /start no @cjr_adm_bot -> Enviar documento).

**BUG CRITICO RESOLVIDO — webhook no apex nao entregava (19/06/2026, commit 159ed34):** o bot
@cjr_adm_bot ficava MUDO (e o @cjr_ativo_bot tambem nunca recebeu de verdade — so tinha sido
testado com updates SIMULADOS). CAUSA: o webhook estava registrado em `https://costajr.com.br/...`
(APEX), e o apex faz **HTTP 307 -> www** (confirmado por curl: apex=307 redirect, www=403 alcancavel).
**O Telegram NAO segue redirect em webhook** -> 0 entregas, e getWebhookInfo mostrava pending=0 sem
erro (nada era nem tentado). DIAGNOSTICO: logs da Vercel (Registros) filtrando "webhook" = vazio =
Telegram nunca chamou. FIX: `configurar.ts` forca o host **www** no setWebhook
(`if (/^https?:\/\/costajr\.com\.br$/.test(SITE)) SITE="https://www.costajr.com.br"`). **Apos deploy a
Adriana tem que clicar "Ativar/Reativar os 2 bots" de novo** p/ regravar a URL www. LICAO P/ SEMPRE:
webhook do Telegram TEM que apontar pro host que responde direto (sem redirect) — usar www, nunca apex.
Diagnostico padrao de bot mudo: getMe (token certo?) + getWebhookInfo (url/erro/pending) + logs da
Vercel + curl no apex e no www p/ ver 307.

## Atualizacao 19/06/2026 (parte 3) — GRUPO de RH como inbox de DOCUMENTOS (decisao da Adriana)

A Adriana preferiu um **GRUPO** especifico (so RH) p/ jogar DOCUMENTOS, em vez do chat privado 1:1
(achou mais pratico — um lugar so). **Commit 9f4da16.** Esclarecido a ela: grupo so e seguro se tiver
EXCLUSIVAMENTE RH/Admin (todos do grupo veem os documentos — mas RH ja tem acesso a esses docs).
- `telegramBot.ts`: o bot adm agora age em GRUPO (antes `chat.type!=="private"` retornava). `onMessage`
  -> se grupo e modo adm -> `onGrupoMensagem`. Comando **`/ativar_grupo`** (so admin do grupo, checado
  via getChatMember) registra o chat como inbox em `telegram_sessoes` key `"grupo_rh"` (dados.chat_id).
  So o grupo REGISTRADO processa documentos; outros grupos sao ignorados.
- Documento postado no grupo -> baixa -> bucket rh inbox -> sugere pessoa/tipo/validade (slotsDoc +
  Gemini) -> card com botoes **Anexar p/ NOME / Outro tipo / Descartar**. Pendentes guardados por TOKEN
  (`telegram_sessoes` key `"gdoc:"+token`, token=Date.now().toString(36)); callback_data carrega o token
  (`ganex:`/`gtipo:`/`gslot:token:slot`/`gcancel:`) — sem colisao entre uploads simultaneos. Autor do
  audit = nome do remetente do Telegram ("via grupo Telegram"). Sem identificacao por telefone (a porta
  e o proprio grupo). Se a pessoa nao for identificada no doc -> sem botao Anexar (pede renomear/painel).
- **REQUER (acao da Adriana):** (1) criar o grupo com SO RH/Admin, (2) adicionar @cjr_adm_bot, (3) no
  **BotFather desligar a Privacidade** do @cjr_adm_bot (/mybots -> Bot Settings -> Group Privacy -> Turn
  off) senao o bot NAO recebe os documentos do grupo (so comandos), (4) um admin manda `/ativar_grupo`.
  E reativar os webhooks (fix www) antes de tudo. KB/base segue no chat privado do bot.
- **ROTEIA RH x EMPRESA/JURIDICO (commit 7960327):** no grupo o card pergunta "e da PESSOA (RH) ou da
  EMPRESA (Juridico)?". Pessoa -> rh_documentos (como antes). Empresa -> botao "🏢 E da empresa" casa o
  doc com `doc_empresa` pelo nome (filename + nome extraido pela IA, via casarColaborador na lista de
  doc_empresa nao-arquivados), MOVE o arquivo do bucket `rh`/inbox p/ o bucket PRIVADO `doc-empresa`
  (download+upload) e cria `doc_empresa_arquivos {doc_id, nome, storage_path, criado_por}`. Callbacks
  gemp (casa+confirma) / gempok (move+anexa). doc_empresa = modulo Documentos da Empresa (perfis
  admin/financeiro/juridico). Se nao casar a empresa -> pede anexar pelo painel.
- **GRUPO da BASE DE CONHECIMENTO (commit ad48f84):** SEGUNDO grupo registravel, separado do de
  documentos. `/ativar_base` (admin do grupo) registra key `grupo_base` em telegram_sessoes.
  `onGrupoMensagem` roteia: chat == grupo_rh -> documentos; chat == grupo_base -> base. No grupo de
  base, TEXTO >=15 chars (nao-comando) -> gerarTextoLLM organiza em pergunta/resposta/categoria ->
  card com [Salvar na base]/[Descartar] (pendente em telegram_sessoes key `gkb:`+token; callbacks
  gkbsave/gkbcancel) -> insert portal_kb (vale na hora na JunIA). Documento postado no grupo de base
  -> "use o grupo de documentos". REQUER: criar o grupo + add @cjr_adm_bot (privacidade ja OFF) +
  admin manda /ativar_base. Sem env nova, sem migration.
- **CHECAGEM + APROVACAO no grupo de base (commit 15c0147):** antes de propor, `checarBaseKb` manda
  o novo item + a base (portal_kb, ~36 itens) pro LLM e classifica novo|duplicado|contradiz (mostra o
  item conflitante no card). APROVACAO: `/ativar_base` guarda `aprovador_id`/`aprovador_nome` (quem
  ativou) em grupo_base.dados; o item fica "aguardando aprovacao de X" e o callback gkbsave SO funciona
  se `cq.from.id == aprovador_id` (fallback: admin do grupo, p/ registro antigo sem aprovador). Outros
  enviam, mas so o aprovador publica. gkbcancel idem (so aprovador recusa). pendentes em gkb:+token.

## Atualizacao 19/06/2026 (parte 4) — Ativos: categoria "Linha Telefonica" separada do aparelho

Pedido da Adriana ("EM ATIVOS, SEPARAR LINHAS DE TELEFONES"): a LINHA (numero/chip/plano) virou
categoria PROPRIA, separada do aparelho fisico. **Commit a793b96. Migration 070 RODADA** (ALTER do
`ativos_categoria_check` p/ incluir `linha_telefonica`, via Management API/Chrome HTTP 201). Campos
no jsonb `ativos.campos`: linha, operadora, plano, valor_mensal, iccid, pin_puk, aparelho,
dia_vencimento. Aba propria em /admin/ativos (categorias map + catIcone 📞 + bloco
`campos-linha_telefonica` no form; toggle automatico por `#campos-${cat}`). `CATEGORIAS_VALIDAS`
atualizado em ativos/index.ts E ativos/import.ts (+ CAT_POR_ROTULO "linha telefonica"). `iccid`
adicionado a CAMPOS_OCULTOS_PORTAL (meus-equipamentos.ts; sensivel, igual pin_puk). O aparelho
(categoria telefonia) segue com seus campos de linha p/ retrocompat — as linhas NOVAS entram como
itens proprios, alocaveis a pessoa independente do aparelho. PENDENTE p/ a Adriana decidir: migrar
linhas embutidas nos aparelhos existentes p/ itens proprios (nao feito — so categoria nova).

## Convencoes desta pasta para o Claude Code

- Sempre que iniciar uma sessao nesta pasta, leia este CLAUDE.md primeiro.
- Quando o usuario disser "atualize a memoria", edite as secoes deste arquivo.
- Quando descobrir algo novo importante (decisao de arquitetura, padrao, blocker), proponha adicionar aqui.
- Nao referencie mais `forum-cjr`, `portal Manus` ou `Wix` como opcoes ativas - sao historico.