-- ============================================================================
-- 105 — Vendas: a margem REAL de cada anúncio, gravada onde o painel enxerga
--
-- Por que existe (15/08/2026): a auditoria diária confere o lucro de verdade
-- de cada anúncio com as taxas que o próprio ML informa — mas só escrevia o
-- resultado no LOG do GitHub Actions. O painel admin continuava mostrando a
-- margem da calculadora (tarifa média + custo fixo da config), que subestima
-- taxa e frete de vários itens: hoje a mesma rodada disse "0 abaixo do piso"
-- na calculadora e "17 no prejuízo + 13 magros" na conta real.
--
-- Estas colunas guardam o que a auditoria mediu, anúncio por anúncio.
-- `auditado_em` (migration 100) diz de quando é a medição.
--
-- Só adiciona coluna. Nada é apagado. (db/COMO_MIGRAR.md)
-- ============================================================================

alter table vendas_produtos add column if not exists ml_taxa_real      numeric(12,2);
alter table vendas_produtos add column if not exists ml_custo_op_real  numeric(12,2);
alter table vendas_produtos add column if not exists ml_frete_auditoria numeric(12,2);
alter table vendas_produtos add column if not exists ml_lucro_real     numeric(12,2);
alter table vendas_produtos add column if not exists ml_margem_real_pct numeric(6,1);

comment on column vendas_produtos.ml_taxa_real is
  'Comissão real da venda (sale_fee) que o ML informou na última auditoria.';
comment on column vendas_produtos.ml_custo_op_real is
  'Custo operacional por unidade (anúncio abaixo do limite de frete grátis) considerado na auditoria.';
comment on column vendas_produtos.ml_frete_auditoria is
  'Frete considerado na auditoria (real do ML quando disponível; senão faixa de peso).';
comment on column vendas_produtos.ml_lucro_real is
  'R$ que sobra por venda depois de taxa + custo operacional + frete + custo do fornecedor.';
comment on column vendas_produtos.ml_margem_real_pct is
  'ml_lucro_real / preço, em %. É a margem que vale — a da calculadora é estimativa.';

notify pgrst, 'reload schema';
