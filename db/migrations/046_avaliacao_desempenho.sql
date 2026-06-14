-- ============================================================================
-- 046 — Avaliação de Desempenho (trimestral: Mar/Jun/Set/Dez)
--   Baseado no board Miro + Fluxos_Automacoes_RH DP (aba DP).
--   Uma avaliacao por colaborador x ano x trimestre x tipo (gestor|autoavaliacao).
--   respostas jsonb = { competencia: nota(1-5) }. IDs TEXT, RLS ligado.
-- ============================================================================

create table if not exists rh_avaliacoes (
  id text primary key default gen_random_uuid()::text,
  colaborador_id text not null references rh_colaboradores(id) on delete cascade,
  ano int not null,
  trimestre int not null,                  -- 1=Mar, 2=Jun, 3=Set, 4=Dez
  tipo text not null default 'gestor',     -- gestor | autoavaliacao
  avaliador_email text,
  avaliador_nome text,
  respostas jsonb,                         -- { competencia: nota }
  nota_geral numeric(4,2),
  pontos_fortes text,
  pontos_desenvolver text,
  metas_pdi text,
  status text not null default 'concluida', -- pendente | concluida
  criado_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (colaborador_id, ano, trimestre, tipo)
);
create index if not exists idx_rh_aval_colab on rh_avaliacoes(colaborador_id);
create index if not exists idx_rh_aval_periodo on rh_avaliacoes(ano, trimestre);

alter table rh_avaliacoes enable row level security;
