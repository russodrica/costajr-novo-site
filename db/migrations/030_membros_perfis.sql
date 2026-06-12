-- ============================================================================
-- 030 — Membros 100% (paridade com o Manus)
-- Múltiplos perfis por usuário, permissão de conteúdo trabalhista e avatar.
-- ============================================================================

alter table portal_profiles add column if not exists roles text[] not null default '{}';
alter table portal_profiles add column if not exists tem_trabalhista boolean not null default false;
alter table portal_profiles add column if not exists avatar_url text;

-- backfill: quem só tem o cargo único passa a tê-lo como lista
update portal_profiles set roles = array[role] where roles = '{}' and role is not null;
