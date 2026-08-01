-- ============================================================================
-- 082 — Vendas: inventário do que já está no ar em cada canal
--
-- Problema que resolve: o portal sabia o que ELE publicou, mas não o que
-- REALMENTE está no ar. Anúncio criado à mão, anúncio antigo do tempo do
-- Bling, e principalmente publicação que FALHOU no meio do caminho ficavam
-- invisíveis. A Adriana lembrava de erros de publicação em alguns produtos e
-- não tinha onde conferir.
--
-- A partir daqui existe uma tabela que é o retrato do canal, não da intenção:
-- cada linha é um anúncio que existe hoje no Mercado Livre ou na Shopee, com
-- preço, estoque e situação, ligado ao produto do catálogo quando dá para
-- ligar. Anúncio que não casa com nenhum produto fica com produto_id nulo —
-- é informação, não erro: são justamente os anúncios que o portal ainda não
-- conhece.
--
-- Como cada canal é lido:
--   • Mercado Livre — API oficial (/users/{id}/items/search + /items). Traz
--     situação real: active, paused, closed, under_review.
--   • Shopee — snapshot _shopee_data.json gerado na aba autenticada da
--     vendedora. A Shopee não abriu API de leitura para esta conta; o
--     snapshot traz sku, nome, preço e id do anúncio. Por isso a coluna
--     `fonte` existe: a tela mostra quando o dado é de API e quando é de
--     snapshot (que pode estar velho).
--
-- Só adiciona tabela/coluna. Nada é apagado. (db/COMO_MIGRAR.md)
-- ============================================================================

create table if not exists vendas_anuncios_canal (
  id text primary key default gen_random_uuid()::text,
  canal text not null check (canal in ('ml', 'shopee')),
  item_id text not null,                    -- MLB7308639812 | 58261857705
  sku text,                                 -- SKU declarado no próprio anúncio
  titulo text,
  preco numeric(12,2),
  estoque integer,
  vendidos integer,
  situacao text,                            -- active | paused | closed | under_review | desconhecida
  tipo_anuncio text,                        -- gold_special | gold_pro (só ML)
  permalink text,
  imagem_url text,
  saude numeric(5,2),                       -- health do ML (0..1) — qualidade do anúncio
  produto_id text references vendas_produtos(id) on delete set null,
  casado_por text check (casado_por is null or casado_por in ('sku_trazpraca','sku_proprio','ml_item_id','shopee_item_id','titulo')),
  fonte text not null default 'api' check (fonte in ('api','snapshot')),
  visto_em timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Um anúncio por canal. É esta unicidade que permite o upsert do inventário.
create unique index if not exists idx_anuncios_canal_unico on vendas_anuncios_canal(canal, item_id);
create index if not exists idx_anuncios_canal_produto on vendas_anuncios_canal(produto_id);
create index if not exists idx_anuncios_canal_sku on vendas_anuncios_canal(sku);
create index if not exists idx_anuncios_canal_situacao on vendas_anuncios_canal(canal, situacao);

alter table vendas_anuncios_canal enable row level security;

-- ------------------------------------------------------ reflexo no produto ----
-- publicado_ml / publicado_shopee já existiam, mas eram preenchidos pela
-- INTENÇÃO (o publicador marcava ao criar). Agora quem manda é o inventário.
alter table vendas_produtos add column if not exists ml_situacao text;
alter table vendas_produtos add column if not exists shopee_situacao text;
alter table vendas_produtos add column if not exists ml_saude numeric(5,2);
alter table vendas_produtos add column if not exists inventariado_em timestamptz;

-- Novo tipo de execução no log.
alter table vendas_sync_log drop constraint if exists vendas_sync_log_tipo_check;
alter table vendas_sync_log add constraint vendas_sync_log_tipo_check
  check (tipo in ('scan_novos','preco_ml','preco_shopee','saldo_trazpraca',
                  'validador_preco','enriquecimento','carga_catalogo',
                  'publicacao_ml','publicacao_shopee','estoque','inventario'));

comment on table  vendas_anuncios_canal is 'Retrato do que está no ar hoje em cada marketplace. Alimentado por src/inventario_main.py.';
comment on column vendas_anuncios_canal.produto_id is 'Nulo = anúncio existe no canal mas o portal não sabe de que produto é.';
comment on column vendas_anuncios_canal.fonte    is 'api = lido ao vivo (ML). snapshot = arquivo gerado na sessão da vendedora (Shopee).';

notify pgrst, 'reload schema';
