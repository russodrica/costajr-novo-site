-- Migration 065: fecha o buraco de RLS nas tabelas manut_* / page_views
-- ============================================================================
-- CONTEXTO (revisão de segurança jun/2026): a chave publishable (anon), que fica
-- embutida no JS do site, tinha READ + WRITE + DELETE em várias tabelas manut_*
-- porque elas foram criadas SEM `enable row level security`. Confirmado AO VIVO:
--   - manut_representantes  -> anon LEU senha_hash, chave_pix, saldo_acumulado (4 linhas)
--   - manut_estoque / *_movimentos / *_alteracoes -> anon LEU; UPDATE/DELETE retornaram 204 (autorizado)
--   - manut_tecnico_lojas -> anon LEU
-- Risco: vazamento de dados pessoais/financeiros (LGPD) + FRAUDE (alterar saldo de
-- cashback, trocar chave PIX, resetar senha_hash de representante).
--
-- MODELO DE ACESSO DO PROJETO: "deny-all + service role". Habilitar RLS SEM criar
-- policy NEGA tudo para anon/authenticated (PostgREST). O backend usa a SERVICE ROLE
-- (supabaseAdmin), que IGNORA RLS — então NADA no app quebra. É exatamente o padrão
-- já usado nas demais tabelas (ativos, rh_*, fin_*, portal_*).
--
-- ➜ Rodar UMA vez no Supabase SQL Editor (fazer backup antes, conforme COMO_MIGRAR.md).
--   É idempotente: re-habilitar RLS é no-op; `if exists` tolera tabela ausente.
-- ============================================================================

alter table if exists public.manut_representantes            enable row level security;
alter table if exists public.manut_representantes_aprovacoes enable row level security;
alter table if exists public.manut_representantes_materiais  enable row level security;
alter table if exists public.manut_representantes_repasses   enable row level security;
alter table if exists public.manut_estoque                   enable row level security;
alter table if exists public.manut_estoque_movimentos        enable row level security;
alter table if exists public.manut_estoque_alteracoes        enable row level security;
alter table if exists public.manut_tecnico_lojas             enable row level security;
alter table if exists public.manut_cupons                    enable row level security;
alter table if exists public.manut_cupons_usos               enable row level security;
alter table if exists public.manut_contrato                  enable row level security;
alter table if exists public.manut_cashback_movimentos       enable row level security;
alter table if exists public.manut_descontos_pendentes       enable row level security;
alter table if exists public.manut_leads                     enable row level security;
alter table if exists public.manut_precificacao              enable row level security;
alter table if exists public.page_views                      enable row level security;

-- Reforço (defense-in-depth): tira o grant default dos papéis públicos. Mesmo com
-- RLS ligado e sem policy o acesso já é negado, mas remover o grant deixa a intenção
-- explícita e cobre o caso de alguém criar uma policy permissiva por engano no futuro.
revoke all on public.manut_representantes,
              public.manut_representantes_aprovacoes,
              public.manut_representantes_materiais,
              public.manut_representantes_repasses,
              public.manut_estoque,
              public.manut_estoque_movimentos,
              public.manut_estoque_alteracoes,
              public.manut_tecnico_lojas,
              public.manut_cupons,
              public.manut_cupons_usos,
              public.manut_contrato,
              public.manut_cashback_movimentos,
              public.manut_descontos_pendentes,
              public.manut_leads,
              public.manut_precificacao,
              public.page_views
  from anon, authenticated;

-- Rodado em produção: 2026-06-17 (via Management API). Verificado ao vivo: a chave
-- anon agora recebe HTTP 401 (42501) em READ/UPDATE/DELETE nessas tabelas, e o
-- audit `pg_tables ... rowsecurity=false` retornou ZERO linhas (schema public 100% RLS).

-- ── AUDITORIA (rode e confira que NÃO sobra nenhuma tabela com rowsecurity=false) ──
-- select tablename from pg_tables
--   where schemaname = 'public' and rowsecurity = false
--   order by tablename;
-- Para QUALQUER tabela que aparecer, avaliar e habilitar RLS do mesmo jeito.
