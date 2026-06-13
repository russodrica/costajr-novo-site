-- ============================================================================
-- 034 — Planejamento de obras: tarefas (cronograma) e anotações
--        Substitui o módulo de planejamento da Vobi (Fase C do plano).
-- ============================================================================

create table if not exists obras_tarefas (
  id text primary key default gen_random_uuid()::text,
  obra_id text not null references obras(id) on delete cascade,
  titulo text not null,
  descricao text,
  etapa text,                                   -- agrupador/cronograma (ex: Fundação, Acabamento)
  responsavel text,
  status text not null default 'pendente' check (status in ('pendente','em_andamento','concluida','cancelada')),
  prioridade text check (prioridade in ('baixa','media','alta')),
  data_inicio date,
  data_fim date,
  ordem integer not null default 0,
  vobi_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_obras_tarefas on obras_tarefas(obra_id, status);

create table if not exists obras_anotacoes (
  id text primary key default gen_random_uuid()::text,
  obra_id text not null references obras(id) on delete cascade,
  texto text not null,
  criado_por text,
  vobi_id text unique,
  created_at timestamptz not null default now()
);
create index if not exists idx_obras_anotacoes on obras_anotacoes(obra_id);

alter table obras_tarefas enable row level security;
alter table obras_anotacoes enable row level security;
