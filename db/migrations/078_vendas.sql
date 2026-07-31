-- ============================================================================
-- 078 — Módulo Vendas (TrazPraCa / Mercado Livre / Shopee)
-- Catálogo de produtos do fornecedor dropship, alertas de preço/estoque e
-- log de sincronização. Segue o padrão dos demais módulos: id text,
-- gen_random_uuid()::text, RLS habilitado (não enforced — controle é via
-- JWT/permissoes.ts no backend, como em todo o projeto).
-- Escrita normal (GET/PATCH/DELETE) via /api/admin/vendas/* (admin logado).
-- Escrita do worker de sincronização (trazpraca-automacao, GitHub Actions)
-- é DIRETA no Supabase via service role key — não passa pela Vercel.
-- ============================================================================

create table if not exists vendas_produtos (
  id text primary key default gen_random_uuid()::text,
  sku_trazpraca text unique,               -- id do produto no marketplace da TrazPraCa (ex: "10526")
  sku_proprio text,                        -- SKU dela (Bling/planilha Gramin) -- ponte com ml_api/shopee_api,
                                            -- que identificam anúncios pelo SKU próprio, não pelo id da TrazPraCa
  nome text not null,
  categoria text,
  custo numeric(12,2),
  preco_sugerido numeric(12,2),            -- preço sugerido pela TrazPraCa (~95% margem)
  preco_ml numeric(12,2),                  -- preço publicado no Mercado Livre
  preco_shopee numeric(12,2),              -- preço publicado na Shopee
  em_estoque_trazpraca boolean not null default true,
  adicionado_trazpraca boolean not null default false,  -- já foi "Adicionar à loja" na TrazPraCa
  publicado_ml boolean not null default false,
  publicado_shopee boolean not null default false,
  ml_item_id text,
  shopee_item_id text,
  url_trazpraca text,
  imagem_url text,
  origem text not null default 'scanner_novo'
    check (origem in ('scanner_novo', 'manual', 'mais_vendidos')),
  status text not null default 'candidato'
    check (status in ('candidato', 'aprovado', 'rejeitado', 'publicado', 'pausado')),
  observacoes text,
  criado_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_vendas_produtos_status on vendas_produtos(status);
create index if not exists idx_vendas_produtos_sku on vendas_produtos(sku_trazpraca);
create index if not exists idx_vendas_produtos_sku_proprio on vendas_produtos(sku_proprio);

create table if not exists vendas_sync_log (
  id text primary key default gen_random_uuid()::text,
  tipo text not null
    check (tipo in ('scan_novos', 'preco_ml', 'preco_shopee', 'saldo_trazpraca', 'validador_preco')),
  status text not null check (status in ('ok', 'erro', 'alerta')),
  itens_encontrados integer default 0,
  itens_novos integer default 0,
  itens_alterados integer default 0,
  mensagem text,
  detalhes jsonb,
  executado_em timestamptz not null default now()
);
create index if not exists idx_vendas_sync_log_executado on vendas_sync_log(executado_em desc);

create table if not exists vendas_alertas (
  id text primary key default gen_random_uuid()::text,
  produto_id text references vendas_produtos(id) on delete cascade,
  tipo text not null
    check (tipo in ('preco_anomalo', 'estoque_zerado', 'saldo_trazpraca_baixo', 'sync_falhou')),
  severidade text not null default 'atencao'
    check (severidade in ('info', 'atencao', 'critico')),
  preco_detectado numeric(12,2),
  preco_esperado numeric(12,2),
  mensagem text,
  resolvido boolean not null default false,
  resolvido_por text,
  resolvido_em timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_vendas_alertas_resolvido on vendas_alertas(resolvido);

create table if not exists vendas_config (
  id text primary key default 'default',
  margem_padrao_pct numeric(6,2) not null default 95,
  alerta_variacao_preco_pct numeric(6,2) not null default 50,  -- dispara alerta se preço variar mais que isso
  saldo_trazpraca_minimo numeric(12,2) not null default 50,
  updated_at timestamptz not null default now()
);
insert into vendas_config (id) values ('default') on conflict (id) do nothing;

alter table vendas_produtos enable row level security;
alter table vendas_sync_log enable row level security;
alter table vendas_alertas enable row level security;
alter table vendas_config enable row level security;

notify pgrst, 'reload schema';
