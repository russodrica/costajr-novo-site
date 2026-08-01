-- ============================================================================
-- 081 — Vendas: frete por peso e tipo de anúncio no Mercado Livre
--
-- Por que existe: até aqui o motor de preço usava UM frete fixo (R$ 22) para
-- qualquer produto acima do limite de frete grátis, e UMA comissão única de
-- 13%. Duas simplificações que inflavam o lucro mostrado na tela:
--
--   • frete fixo trata uma luminária de 1,6 kg igual a um quadro de 0,4 kg;
--   • comissão única ignora que Premium cobra bem mais que Clássico.
--
-- Somadas, no pior caso a Mini Luminária Snoopy saía de +R$ 14,45 na tela para
-- -R$ 24,67 na vida real. Era exatamente o tipo de erro que já causou venda
-- cancelada por preço errado.
--
-- ---------------------------------------------------------------------------
-- DE ONDE VIERAM OS NÚMEROS
--
-- Tipo de anúncio: da própria planilha da Adriana. Dos 184 produtos que ela já
-- anunciou no ML, 182 são CLÁSSICO e 2 são Premium. Padrão = clássico.
--
-- Faixas de frete: calibradas com os 4 anúncios dela que têm frete e peso
-- registrados na planilha —
--       0,200 kg → R$  6,75
--       0,520 kg → R$ 17,05
--       1,160 kg → R$ 26,25
--       6,600 kg → R$ 70,25
-- A faixa de 3 kg (R$ 41,13) é interpolada entre os dois últimos pontos
-- (R$ 8,09 por kg). São só 4 pontos — evidência magra, e por isso o valor
-- REAL é consultado na API do Mercado Livre por produto durante o
-- enriquecimento. Quando existe, o valor da API manda. A tela sempre mostra
-- de onde veio o número: "real do Mercado Livre", "faixa de peso" ou
-- "estimado, sem peso".
-- ============================================================================

alter table vendas_config add column if not exists ml_tipo_anuncio text not null default 'classico'
  check (ml_tipo_anuncio in ('classico','premium'));
alter table vendas_config add column if not exists ml_comissao_classico_pct numeric(6,2) not null default 13;
alter table vendas_config add column if not exists ml_comissao_premium_pct numeric(6,2) not null default 17;
alter table vendas_config add column if not exists ml_frete_faixas jsonb not null default '[]'::jsonb;

update vendas_config
   set ml_frete_faixas = '[
        {"ate_kg": 0.3,  "custo": 6.75},
        {"ate_kg": 0.6,  "custo": 17.05},
        {"ate_kg": 1.5,  "custo": 26.25},
        {"ate_kg": 3.0,  "custo": 41.13},
        {"ate_kg": null, "custo": 70.25}
       ]'::jsonb
 where id = 'default'
   and (ml_frete_faixas is null or ml_frete_faixas = '[]'::jsonb);

-- Frete real consultado na API do ML para ESTE produto, e quando foi consultado.
alter table vendas_produtos add column if not exists ml_frete_real numeric(12,2);
alter table vendas_produtos add column if not exists ml_frete_consultado_em timestamptz;
-- Origem do frete usado na conta: 'api' | 'faixa' | 'estimativa'.
alter table vendas_produtos add column if not exists ml_frete_fonte text
  check (ml_frete_fonte is null or ml_frete_fonte in ('api','faixa','estimativa'));

notify pgrst, 'reload schema';
