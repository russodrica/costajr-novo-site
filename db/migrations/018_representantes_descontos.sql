-- Migration 018: Representantes (terceiros divulgadores) + desconto recorrente por N meses
-- - Cria tabela manut_representantes (parceiros externos, não-clientes, que indicam o serviço)
-- - Cria tabela manut_representantes_repasses (histórico de pagamentos de comissão)
-- - Adiciona coluna representante_id em manut_cupons
-- - Estende CHECK de manut_cupons.tipo para incluir 'representante'
-- - Cria tabela manut_descontos_pendentes (cashback reverso para aplicar desconto pelos N meses do cupom)
-- Data: 2026-05-20
-- Seguro para rodar em banco com dados existentes (IF NOT EXISTS / IF EXISTS).

-- 1. Representantes externos (não são clientes, são divulgadores/parceiros)
create table if not exists manut_representantes (
  id text primary key default gen_random_uuid()::text,
  nome text not null,
  email text not null,
  telefone text,
  saldo_acumulado numeric(10,2) not null default 0,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_manut_representantes_email on manut_representantes(lower(email));

-- 2. Histórico de repasses pagos aos representantes
create table if not exists manut_representantes_repasses (
  id text primary key default gen_random_uuid()::text,
  representante_id text not null references manut_representantes(id) on delete cascade,
  valor numeric(10,2) not null check (valor > 0),
  data_repasse date not null default current_date,
  observacao text,
  created_at timestamptz not null default now()
);

create index if not exists idx_manut_repasses_rep on manut_representantes_repasses(representante_id, created_at desc);

-- 3. Cupons agora podem ter um representante como dono (alternativa ao cliente_dono_id)
alter table manut_cupons add column if not exists representante_id text references manut_representantes(id) on delete set null;
create index if not exists idx_manut_cupons_representante on manut_cupons(representante_id);

-- 4. Permite tipo='representante' no CHECK constraint
alter table manut_cupons drop constraint if exists manut_cupons_tipo_check;
alter table manut_cupons add constraint manut_cupons_tipo_check
  check (tipo in ('desconto','indicacao','nova_loja','representante'));

-- 5. Descontos pendentes — cashback reverso para aplicar desconto pelos próximos N-1 meses
--    (o 1º mês já é descontado direto no contratarSubmit; este registro cobre os meses 2..N).
--    Cron diário consome esta tabela: quando proximo_credito_em <= hoje e concluido=false,
--    credita valor_credito_mensal em manut_clientes.saldo_cashback e decrementa meses_restantes.
create table if not exists manut_descontos_pendentes (
  id text primary key default gen_random_uuid()::text,
  cliente_id text not null references manut_clientes(id) on delete cascade,
  cupom_id text references manut_cupons(id) on delete set null,
  meses_restantes integer not null check (meses_restantes >= 0),
  valor_credito_mensal numeric(10,2) not null check (valor_credito_mensal > 0),
  proximo_credito_em date not null,
  concluido boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_descontos_pendentes_proximo
  on manut_descontos_pendentes(proximo_credito_em)
  where concluido = false;

create index if not exists idx_descontos_pendentes_cliente
  on manut_descontos_pendentes(cliente_id);
