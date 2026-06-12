-- ============================================================================
-- 023 — Módulo Comercial (CRM)
-- Funil kanban sobre manut_leads + propostas + metas mensais.
-- ============================================================================

-- Campos extras no lead para gestão comercial
alter table manut_leads add column if not exists kanban_ordem integer not null default 0;
alter table manut_leads add column if not exists responsavel text;
alter table manut_leads add column if not exists proximo_contato date;
alter table manut_leads add column if not exists origem text;

create table if not exists com_propostas (
  id text primary key default gen_random_uuid()::text,
  lead_id text references manut_leads(id),
  cliente_nome text not null,
  titulo text not null,
  valor numeric(14,2),
  status text not null default 'rascunho' check (status in ('rascunho','enviada','aceita','recusada','expirada')),
  url_pdf text,
  valido_ate date,
  observacoes text,
  criado_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_com_propostas_lead on com_propostas(lead_id);
create index if not exists idx_com_propostas_status on com_propostas(status);

create table if not exists com_metas (
  id text primary key default gen_random_uuid()::text,
  referencia text not null unique, -- 'YYYY-MM'
  meta_valor numeric(14,2),
  meta_leads integer,
  meta_conversoes integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table com_propostas enable row level security;
alter table com_metas enable row level security;
