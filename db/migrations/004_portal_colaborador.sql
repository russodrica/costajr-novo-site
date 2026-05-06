-- ============================================================================
-- PORTAL DO COLABORADOR — tabelas adicionais
-- Migração: forum-cjr (MySQL/Drizzle) → Supabase PostgreSQL
-- ============================================================================

-- ─── Treinamentos ────────────────────────────────────────────────────────────

create table if not exists portal_treinamentos_videos (
  id text primary key default gen_random_uuid()::text,
  titulo text not null,
  descricao text,
  url_video text not null,
  thumbnail_url text,
  categoria text not null default 'geral',
  access_roles text[] not null default '{all}',
  duracao_minutos integer,
  ordem integer not null default 0,
  publicado boolean not null default true,
  created_by text references portal_profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_portal_videos_categoria on portal_treinamentos_videos(categoria, publicado);

create table if not exists portal_treinamentos_pdfs (
  id text primary key default gen_random_uuid()::text,
  titulo text not null,
  descricao text,
  storage_path text,
  url text,
  categoria text not null default 'geral',
  access_roles text[] not null default '{all}',
  paginas integer,
  ordem integer not null default 0,
  publicado boolean not null default true,
  created_by text references portal_profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists portal_video_progress (
  id text primary key default gen_random_uuid()::text,
  user_id text not null references portal_profiles(id) on delete cascade,
  video_id text not null references portal_treinamentos_videos(id) on delete cascade,
  progresso_segundos integer not null default 0,
  concluido boolean not null default false,
  updated_at timestamptz not null default now(),
  unique(user_id, video_id)
);

-- ─── Fórum ───────────────────────────────────────────────────────────────────

create table if not exists portal_forum_topicos (
  id text primary key default gen_random_uuid()::text,
  titulo text not null,
  conteudo text not null,
  categoria text not null default 'geral',
  autor_id text not null references portal_profiles(id),
  autor_nome text not null,
  fixado boolean not null default false,
  fechado boolean not null default false,
  views integer not null default 0,
  respostas_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_forum_topicos_cat on portal_forum_topicos(categoria, created_at desc);

create table if not exists portal_forum_respostas (
  id text primary key default gen_random_uuid()::text,
  topico_id text not null references portal_forum_topicos(id) on delete cascade,
  conteudo text not null,
  autor_id text not null references portal_profiles(id),
  autor_nome text not null,
  melhor_resposta boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_forum_respostas_topico on portal_forum_respostas(topico_id, created_at);

-- ─── Onboarding ──────────────────────────────────────────────────────────────

create table if not exists portal_onboarding_steps (
  id text primary key default gen_random_uuid()::text,
  titulo text not null,
  conteudo text not null,
  tipo text not null default 'texto' check (tipo in ('texto','video','pdf','tarefa')),
  url_recurso text,
  access_roles text[] not null default '{all}',
  ordem integer not null default 0,
  obrigatorio boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists portal_onboarding_progress (
  id text primary key default gen_random_uuid()::text,
  user_id text not null references portal_profiles(id) on delete cascade,
  step_id text not null references portal_onboarding_steps(id) on delete cascade,
  concluido boolean not null default false,
  concluido_em timestamptz,
  unique(user_id, step_id)
);

-- ─── Pontos e gamificação ────────────────────────────────────────────────────

create table if not exists portal_user_points (
  id text primary key default gen_random_uuid()::text,
  user_id text not null references portal_profiles(id) on delete cascade,
  pontos integer not null default 0,
  motivo text not null,
  referencia_tipo text,
  referencia_id text,
  created_at timestamptz not null default now()
);
create index if not exists idx_portal_points_user on portal_user_points(user_id, created_at desc);

-- ─── Documentos de integração (por setor) ────────────────────────────────────

create table if not exists portal_integration_pdfs (
  id text primary key default gen_random_uuid()::text,
  titulo text not null,
  descricao text,
  storage_path text,
  url text,
  setor text not null default 'todos',
  access_roles text[] not null default '{all}',
  versao text,
  ordem integer not null default 0,
  publicado boolean not null default true,
  created_by text references portal_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── Sessões portal colaborador ──────────────────────────────────────────────

create table if not exists portal_sessoes (
  id text primary key default gen_random_uuid()::text,
  token text unique not null,
  user_id text not null references portal_profiles(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_portal_sessoes_token on portal_sessoes(token);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

alter table portal_treinamentos_videos  enable row level security;
alter table portal_treinamentos_pdfs    enable row level security;
alter table portal_video_progress       enable row level security;
alter table portal_forum_topicos        enable row level security;
alter table portal_forum_respostas      enable row level security;
alter table portal_onboarding_steps     enable row level security;
alter table portal_onboarding_progress  enable row level security;
alter table portal_user_points          enable row level security;
alter table portal_integration_pdfs     enable row level security;
alter table portal_sessoes              enable row level security;

-- ─── Dados iniciais de onboarding ────────────────────────────────────────────

insert into portal_onboarding_steps (titulo, conteudo, tipo, access_roles, ordem, obrigatorio) values
  ('Bem-vindo à Costa Júnior', 'Seja muito bem-vindo! Neste portal você terá acesso a treinamentos, documentos, comunicados e ferramentas do seu setor. Navegue pelas abas para conhecer tudo que está disponível para você.', 'texto', '{all}', 1, true),
  ('Política de Conduta', 'Leia nossa política interna de conduta e comportamento. Este documento é fundamental para garantir um ambiente de trabalho saudável e produtivo para todos.', 'pdf', '{all}', 2, true),
  ('Tour pela plataforma', 'Explore cada módulo: Treinamentos (conteúdos do seu setor), Fórum (troca de ideias com a equipe), Documentos Técnicos (manuais e procedimentos) e painéis específicos do seu cargo.', 'texto', '{all}', 3, false)
on conflict do nothing;
