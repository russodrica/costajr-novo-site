-- Migration 013: Recursos novos do painel cliente
-- - disciplinas selecionáveis por loja
-- - chamado extra 48h / emergencial 24h
-- - visitas adicionais agendáveis
-- - cupons de indicação e cashback
-- Data: 2026-05-11

-- 1. Disciplinas selecionáveis por loja
alter table manut_lojas add column if not exists disciplinas text[] not null default '{eletrica,hidraulica,civil}';

-- 2. Tipo de chamado: normal (na próxima visita, grátis) | extra (48h, R$ 250) | emergencial (24h, R$ 350)
alter table manut_chamados add column if not exists tipo_chamado text not null default 'normal'
  check (tipo_chamado in ('normal','extra','emergencial'));
alter table manut_chamados add column if not exists valor_chamado numeric(10,2);
alter table manut_chamados add column if not exists mp_pix jsonb;
alter table manut_chamados add column if not exists pago_em timestamptz;
alter table manut_chamados add column if not exists prazo_atendimento timestamptz;

-- 3. Visitas adicionais e cashback no cliente
alter table manut_clientes add column if not exists visitas_adicionais_disponiveis integer not null default 0;
alter table manut_clientes add column if not exists saldo_cashback numeric(10,2) not null default 0;

-- 4. Tipo de preventiva (mensal padrão vs adicional solicitada pelo cliente)
alter table manut_preventivas add column if not exists tipo_visita text not null default 'mensal'
  check (tipo_visita in ('mensal','adicional'));
alter table manut_preventivas add column if not exists solicitada_pelo_cliente boolean not null default false;

-- 5. Estende cupons para suportar indicação com cashback
alter table manut_cupons add column if not exists cliente_dono_id text references manut_clientes(id) on delete set null;
alter table manut_cupons add column if not exists tipo text not null default 'desconto'
  check (tipo in ('desconto','indicacao','nova_loja'));
alter table manut_cupons add column if not exists cashback_pct numeric(5,2) not null default 0;

create index if not exists idx_manut_cupons_dono on manut_cupons(cliente_dono_id);

-- 6. Histórico de uso dos cupons (para cashback)
create table if not exists manut_cupons_usos (
  id text primary key default gen_random_uuid()::text,
  cupom_id text not null references manut_cupons(id) on delete cascade,
  cliente_que_usou_id text not null references manut_clientes(id) on delete cascade,
  cliente_dono_id text references manut_clientes(id) on delete set null,
  valor_compra numeric(10,2) not null,
  cashback_gerado numeric(10,2) not null default 0,
  desconto_aplicado numeric(10,2) not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_manut_cupons_usos_dono on manut_cupons_usos(cliente_dono_id);
create index if not exists idx_manut_cupons_usos_quem_usou on manut_cupons_usos(cliente_que_usou_id);

-- 7. Histórico de movimentações de cashback (creditos e usos)
create table if not exists manut_cashback_movimentos (
  id text primary key default gen_random_uuid()::text,
  cliente_id text not null references manut_clientes(id) on delete cascade,
  tipo text not null check (tipo in ('credito','debito','expiracao')),
  valor numeric(10,2) not null,
  saldo_apos numeric(10,2) not null,
  origem text not null,
  referencia_id text,
  created_at timestamptz not null default now()
);

create index if not exists idx_cashback_mov_cliente on manut_cashback_movimentos(cliente_id, created_at desc);
