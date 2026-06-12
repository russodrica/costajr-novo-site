-- ============================================================================
-- 022 — Módulo Financeiro
-- Contas a pagar/receber, categorias e fluxo de caixa consolidado.
-- Os pagamentos de manutenção (manut_pagamentos) continuam onde estão;
-- a tela do financeiro consolida as duas fontes na visão de caixa.
-- ============================================================================

create table if not exists fin_categorias (
  id text primary key default gen_random_uuid()::text,
  nome text not null,
  tipo text not null check (tipo in ('receita','despesa')),
  cor text not null default '#9CA3AF',
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists fin_lancamentos (
  id text primary key default gen_random_uuid()::text,
  tipo text not null check (tipo in ('receita','despesa')),
  descricao text not null,
  categoria_id text references fin_categorias(id),
  valor numeric(14,2) not null,
  data_vencimento date not null,
  data_pagamento date,
  status text not null default 'previsto' check (status in ('previsto','pago','atrasado','cancelado')),
  forma_pagamento text,
  fornecedor_cliente text,
  obra_id text references obras(id),
  documento_url text,
  recorrente boolean not null default false,
  observacoes text,
  criado_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_fin_lanc_venc on fin_lancamentos(data_vencimento);
create index if not exists idx_fin_lanc_status on fin_lancamentos(status);
create index if not exists idx_fin_lanc_tipo on fin_lancamentos(tipo);

-- Categorias padrão
insert into fin_categorias (nome, tipo, cor) values
  ('Contratos de manutenção', 'receita', '#16A34A'),
  ('Obras e serviços', 'receita', '#22C55E'),
  ('Venda de materiais', 'receita', '#4ADE80'),
  ('Outras receitas', 'receita', '#86EFAC'),
  ('Folha de pagamento', 'despesa', '#B91C1C'),
  ('Materiais e insumos', 'despesa', '#DC2626'),
  ('Veículos e combustível', 'despesa', '#EF4444'),
  ('Aluguel e contas fixas', 'despesa', '#F87171'),
  ('Impostos e taxas', 'despesa', '#FB923C'),
  ('Equipamentos e ferramentas', 'despesa', '#F59E0B'),
  ('Marketing e comercial', 'despesa', '#FBBF24'),
  ('Outras despesas', 'despesa', '#FCA5A5')
on conflict do nothing;

alter table fin_categorias enable row level security;
alter table fin_lancamentos enable row level security;
