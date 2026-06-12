-- ============================================================================
-- 033 — JunIA (chat inteligente) + notificações in-app do portal
-- ============================================================================

create table if not exists portal_notificacoes (
  id text primary key default gen_random_uuid()::text,
  user_id text not null references portal_profiles(id) on delete cascade,
  tipo text not null default 'geral',     -- resposta_disponivel | comunicado | termo | geral
  titulo text not null,
  mensagem text,
  link text,
  lida boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_portal_notif on portal_notificacoes(user_id, lida, created_at desc);
alter table portal_notificacoes enable row level security;

-- vincula a pendência à conversa de origem (para responder dentro do chat)
alter table portal_pending_questions add column if not exists conversation_id text;
