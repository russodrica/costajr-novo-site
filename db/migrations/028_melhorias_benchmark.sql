-- ============================================================================
-- 028 — Melhorias do benchmark (#2, #4, #5, #6, #7, #10)
-- ============================================================================

-- ─── #2 OS do técnico: fotos antes/depois + geolocalização ──────────────────
alter table manut_chamados add column if not exists fotos_antes text[] not null default '{}';
alter table manut_chamados add column if not exists fotos_depois text[] not null default '{}';
alter table manut_chamados add column if not exists geo_lat numeric(10,7);
alter table manut_chamados add column if not exists geo_lng numeric(10,7);
alter table manut_chamados add column if not exists geo_registrado_em timestamptz;

-- ─── #4 Conciliação bancária (OFX) ───────────────────────────────────────────
alter table fin_lancamentos add column if not exists conciliado boolean not null default false;

create table if not exists fin_extrato_ofx (
  id text primary key default gen_random_uuid()::text,
  fitid text unique not null,           -- id único da transação no OFX
  conta text,                            -- banco/conta de origem do extrato
  data date not null,
  valor numeric(14,2) not null,          -- positivo=crédito, negativo=débito
  descricao text,
  lancamento_id text references fin_lancamentos(id),
  status text not null default 'pendente' check (status in ('pendente','conciliado','ignorado')),
  importado_em timestamptz not null default now()
);
create index if not exists idx_fin_ofx_status on fin_extrato_ofx(status);
create index if not exists idx_fin_ofx_data on fin_extrato_ofx(data);

-- ─── #6 Admissão digital ─────────────────────────────────────────────────────
create table if not exists rh_admissoes (
  id text primary key default gen_random_uuid()::text,
  token text unique not null default gen_random_uuid()::text,
  nome text not null,
  email text,
  telefone text,
  cargo text,
  regime text check (regime in ('clt','pj','estagio','temporario')),
  status text not null default 'aguardando' check (status in ('aguardando','docs_enviados','concluida','cancelada')),
  colaborador_id text references rh_colaboradores(id),
  observacoes text,
  criado_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists rh_admissoes_docs (
  id text primary key default gen_random_uuid()::text,
  admissao_id text not null references rh_admissoes(id),
  tipo text not null,                    -- rg, cpf, ctps, comprovante_residencia, foto, aso, cnh, outro
  nome_arquivo text,
  storage_path text not null,            -- bucket privado "rh"
  created_at timestamptz not null default now()
);
create index if not exists idx_rh_adm_docs on rh_admissoes_docs(admissao_id);

-- ─── #7 RDO — Diário de obra ────────────────────────────────────────────────
create table if not exists obras_rdo (
  id text primary key default gen_random_uuid()::text,
  obra_id text not null references obras(id),
  data date not null,
  clima_manha text check (clima_manha in ('sol','nublado','chuva','impraticavel')),
  clima_tarde text check (clima_tarde in ('sol','nublado','chuva','impraticavel')),
  efetivo integer,
  atividades text not null,
  ocorrencias text,
  equipamentos text,
  fotos text[] not null default '{}',
  criado_por text,
  created_at timestamptz not null default now(),
  unique(obra_id, data)
);
create index if not exists idx_obras_rdo on obras_rdo(obra_id, data desc);

-- ─── #10 Plano de manutenção preventiva por ativo ───────────────────────────
create table if not exists ativos_manutencao_planos (
  id text primary key default gen_random_uuid()::text,
  ativo_id text not null references ativos(id),
  titulo text not null,                  -- ex: "Revisão dos 10.000 km", "Troca de óleo"
  periodicidade_dias integer not null,
  ultima_em date,
  proxima_em date not null,
  observacoes text,
  ativo boolean not null default true,
  criado_por text,
  created_at timestamptz not null default now()
);
create index if not exists idx_ativos_planos on ativos_manutencao_planos(proxima_em) where ativo;

-- ─── RLS ─────────────────────────────────────────────────────────────────────
alter table fin_extrato_ofx enable row level security;
alter table rh_admissoes enable row level security;
alter table rh_admissoes_docs enable row level security;
alter table obras_rdo enable row level security;
alter table ativos_manutencao_planos enable row level security;
