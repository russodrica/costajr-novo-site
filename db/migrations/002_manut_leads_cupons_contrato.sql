-- Migration 002: Adiciona tabelas manut_leads, manut_cupons, manut_contrato
-- Seguro para rodar em banco com dados existentes (CREATE TABLE IF NOT EXISTS)
-- Data: 2026-05-05

-- Leads / pré-cadastros do wizard de contratação
create table if not exists manut_leads (
  id text primary key default gen_random_uuid()::text,
  nome text not null,
  nome_loja text,
  email text not null,
  telefone text,
  plano text,
  valor numeric(10,2),
  etapa text not null default 'novo' check (etapa in ('novo','contato_feito','proposta_enviada','negociando','convertido','perdido')),
  observacoes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Índice para evitar busca full-scan por email
create index if not exists idx_manut_leads_email on manut_leads(email);

-- Cupons de desconto
create table if not exists manut_cupons (
  id text primary key default gen_random_uuid()::text,
  codigo text unique not null,
  descricao text,
  desconto_percentual numeric(5,2) not null check (desconto_percentual > 0 and desconto_percentual <= 100),
  duracao_meses integer not null default 1,
  usos_maximos integer,
  usos_atuais integer not null default 0,
  validade timestamptz,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

-- Contrato/termo de serviço editável pelo admin
create table if not exists manut_contrato (
  id integer primary key default 1,
  texto text not null default '',
  updated_at timestamptz not null default now()
);

-- Garante que existe exatamente um registro (id=1)
insert into manut_contrato (id, texto) values (1, '')
on conflict (id) do nothing;
