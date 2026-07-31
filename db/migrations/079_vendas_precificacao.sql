-- ============================================================================
-- 079 — Precificação do módulo Vendas
--
-- Guarda as taxas de cada canal em BANCO (não em código) porque marketplace
-- muda taxa com frequência — assim dá pra ajustar sem depender de deploy.
--
-- Valores padrão levantados em jul/2026:
--   Mercado Livre: comissão 11–14% (clássico) / 16–19% (premium);
--                  custo fixo por item abaixo de R$79; acima disso o frete
--                  grátis é obrigatório e o vendedor banca parte.
--   Shopee:        faixas por preço — 20% + R$4 até R$79,99; acima disso
--                  14% + taxa fixa crescente por faixa.
--
-- O cálculo em si fica em src/lib/precificacao.ts (com testes).
-- ============================================================================

alter table vendas_config
  add column if not exists ml_comissao_pct        numeric(6,2)  not null default 13,
  add column if not exists ml_custo_fixo          numeric(12,2) not null default 6.00,
  add column if not exists ml_frete_estimado      numeric(12,2) not null default 22.00,
  add column if not exists ml_limite_frete_gratis numeric(12,2) not null default 79.00,
  add column if not exists shopee_campanha_pct    numeric(6,2)  not null default 0,
  add column if not exists margem_alvo_pct        numeric(6,2)  not null default 30,
  add column if not exists shopee_faixas          jsonb         not null default '[
    {"ate": 79.99,  "pct": 20, "fixo": 4},
    {"ate": 99.99,  "pct": 14, "fixo": 16},
    {"ate": 199.99, "pct": 14, "fixo": 20},
    {"ate": 499.99, "pct": 14, "fixo": 26},
    {"ate": null,   "pct": 14, "fixo": 28}
  ]'::jsonb;

comment on column vendas_config.ml_comissao_pct        is 'Comissão do Mercado Livre em %. Clássico ~11-14, Premium ~16-19 (varia por categoria).';
comment on column vendas_config.ml_custo_fixo          is 'Taxa fixa por item que o ML cobra em vendas ABAIXO do limite de frete grátis.';
comment on column vendas_config.ml_frete_estimado      is 'Quanto a vendedora banca de frete, em média, ACIMA do limite. Estimativa — varia por peso, distância e reputação.';
comment on column vendas_config.ml_limite_frete_gratis is 'A partir deste preço o frete grátis vira obrigatório no ML. Cria a "zona morta" logo acima dele.';
comment on column vendas_config.shopee_faixas          is 'Faixas de comissão da Shopee: [{ate, pct, fixo}]. ate=null é a última faixa (sem teto).';
comment on column vendas_config.shopee_campanha_pct    is 'Adicional de comissão da Shopee durante campanhas promocionais.';
comment on column vendas_config.margem_alvo_pct        is 'Margem LÍQUIDA desejada (depois das taxas). Usada para calcular o preço mínimo de cada produto.';

-- garante que a linha padrão existe mesmo se a 078 não tiver rodado o insert
insert into vendas_config (id) values ('default') on conflict (id) do nothing;

notify pgrst, 'reload schema';
