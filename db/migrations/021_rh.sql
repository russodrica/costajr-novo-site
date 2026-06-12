-- ============================================================================
-- 021 — Módulo RH (Pessoas)
-- Ficha completa do colaborador, férias/ausências e documentos.
-- Liga-se opcionalmente a portal_profiles (acesso ao portal do colaborador).
-- ============================================================================

create table if not exists rh_colaboradores (
  id text primary key default gen_random_uuid()::text,
  profile_id text references portal_profiles(id),
  nome text not null,
  email text,
  telefone text,
  cpf text,
  rg text,
  data_nascimento date,
  foto_url text,
  -- Dados do contrato
  cargo text,
  setor text,
  regime text check (regime in ('clt','pj','estagio','temporario','socio')),
  salario numeric(12,2),
  data_admissao date,
  data_desligamento date,
  status text not null default 'ativo' check (status in ('ativo','ferias','afastado','desligado')),
  -- Endereço e emergência
  endereco text,
  cidade text,
  uf text,
  contato_emergencia_nome text,
  contato_emergencia_telefone text,
  -- Pagamento
  pix text,
  banco text,
  agencia text,
  conta text,
  observacoes text,
  criado_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_rh_colab_status on rh_colaboradores(status);
create index if not exists idx_rh_colab_setor on rh_colaboradores(setor);

create table if not exists rh_ausencias (
  id text primary key default gen_random_uuid()::text,
  colaborador_id text not null references rh_colaboradores(id),
  tipo text not null check (tipo in ('ferias','atestado','falta','licenca','folga','outro')),
  data_inicio date not null,
  data_fim date not null,
  dias integer,
  motivo text,
  status text not null default 'solicitada' check (status in ('solicitada','aprovada','rejeitada','concluida')),
  aprovado_por text,
  observacoes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_rh_ausencias_colab on rh_ausencias(colaborador_id, data_inicio desc);

create table if not exists rh_documentos (
  id text primary key default gen_random_uuid()::text,
  colaborador_id text not null references rh_colaboradores(id),
  titulo text not null,
  tipo text not null default 'outro' check (tipo in ('contrato','aso','ficha_epi','advertencia','atestado','certificado','cnh','outro')),
  url text,
  validade date,
  observacoes text,
  criado_por text,
  created_at timestamptz not null default now()
);
create index if not exists idx_rh_docs_colab on rh_documentos(colaborador_id);
create index if not exists idx_rh_docs_validade on rh_documentos(validade);

alter table rh_colaboradores enable row level security;
alter table rh_ausencias enable row level security;
alter table rh_documentos enable row level security;
