-- ============================================================================
-- 064 — Permissão granular POR USUÁRIO (override do perfil), com nível ver/editar
-- Cada linha sobrescreve, para UM usuário, o acesso a UM módulo do admin.
-- Ausência de linha = "herda do perfil". nivel: nenhum | ver | editar.
-- ============================================================================

create table if not exists portal_perm_usuario (
  id text primary key default gen_random_uuid()::text,
  profile_id text not null references portal_profiles(id) on delete cascade,
  modulo text not null,                       -- key do módulo do admin (ex.: ativos, obras, financeiro)
  nivel text not null default 'nenhum',       -- nenhum | ver | editar
  updated_at timestamptz not null default now(),
  unique (profile_id, modulo)
);

create index if not exists idx_perm_usuario_profile on portal_perm_usuario(profile_id);

alter table portal_perm_usuario enable row level security;
