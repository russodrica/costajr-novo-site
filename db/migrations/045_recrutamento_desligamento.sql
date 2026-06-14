-- ============================================================================
-- 045 — Fluxo de Contratação (Recrutamento & Seleção) + Desligamento
--   Baseado no board Miro "Fluxo: RH e DP".
--   rh_vagas:        vagas abertas (demandante, regime, status).
--   rh_candidatos:   pipeline (kanban) — etapas triagem→teste→entrevistas→
--                    proposta→admissao→contratado / reprovado.
--   rh_desligamentos: processo de demissão + entrevista de desligamento + checklist.
--   IDs TEXT, RLS ligado (service role).
-- ============================================================================

create table if not exists rh_vagas (
  id text primary key default gen_random_uuid()::text,
  titulo text not null,
  cargo text,
  regime text,                              -- clt | pj | estagio | temporario
  setor text,
  demandante text,
  quantidade int not null default 1,
  descricao text,
  status text not null default 'aberta',    -- aberta | em_andamento | preenchida | cancelada
  criado_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_rh_vagas_status on rh_vagas(status);

create table if not exists rh_candidatos (
  id text primary key default gen_random_uuid()::text,
  vaga_id text references rh_vagas(id) on delete set null,
  nome text not null,
  email text,
  telefone text,
  -- etapa do funil (espelha o board):
  -- triagem | teste | entrevista_comportamental | entrevista_tecnica |
  -- proposta | admissao | contratado | reprovado
  etapa text not null default 'triagem',
  origem text,                              -- onde veio (indicação, gupy, etc)
  teste_resultado text,
  entrevista_comportamental_em date,
  entrevista_tecnica_em date,
  feedback text,
  motivo_reprovacao text,
  colaborador_id text references rh_colaboradores(id) on delete set null, -- quando vira colaborador
  observacoes text,
  criado_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_rh_candidatos_vaga on rh_candidatos(vaga_id);
create index if not exists idx_rh_candidatos_etapa on rh_candidatos(etapa);

create table if not exists rh_desligamentos (
  id text primary key default gen_random_uuid()::text,
  colaborador_id text not null references rh_colaboradores(id) on delete cascade,
  data_desligamento date,
  tipo text,                                -- pedido | sem_justa_causa | justa_causa | fim_contrato | acordo
  motivo text,
  entrevista jsonb,                         -- respostas do formulário de entrevista de desligamento
  checklist jsonb,                          -- devolução EPI/ferramentas, acessos revogados, docs, etc.
  status text not null default 'aberto',    -- aberto | concluido
  criado_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_rh_desligamentos_colab on rh_desligamentos(colaborador_id);

alter table rh_vagas enable row level security;
alter table rh_candidatos enable row level security;
alter table rh_desligamentos enable row level security;
