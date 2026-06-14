-- 059_depositos_vendido.sql
-- Depósitos (locais de estoque/guarda) + destino de transferência 'deposito'
-- + status 'vendido' com valor/data da venda.

-- ── Depósitos ────────────────────────────────────────────────────────────────
create table if not exists depositos (
  id text primary key default gen_random_uuid()::text,
  nome text not null,
  endereco text,
  cidade text,
  uf text,
  responsavel text,
  observacoes text,
  ativo boolean not null default true,
  criado_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table depositos enable row level security;
create index if not exists idx_depositos_ativo on depositos(ativo);

-- seed dos 2 depósitos atuais (idempotente)
insert into depositos (nome) select 'Ipiranga'      where not exists (select 1 from depositos where nome = 'Ipiranga');
insert into depositos (nome) select 'Rua Ipiranga'  where not exists (select 1 from depositos where nome = 'Rua Ipiranga');

-- ── Ativos: aceitar destino 'deposito' e status 'vendido' ────────────────────
alter table ativos drop constraint if exists ativos_alocado_para_tipo_check;
alter table ativos add constraint ativos_alocado_para_tipo_check
  check (alocado_para_tipo in ('colaborador', 'obra', 'deposito'));

alter table ativos drop constraint if exists ativos_status_check;
alter table ativos add constraint ativos_status_check
  check (status in ('em_estoque', 'disponivel', 'alocado', 'em_manutencao', 'em_transito',
                    'extraviado', 'roubado', 'danificado', 'baixado', 'descartado', 'vendido'));

alter table ativos add column if not exists valor_venda numeric(12,2);
alter table ativos add column if not exists data_venda date;

notify pgrst, 'reload schema';
