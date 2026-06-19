-- 071_ativos_status_a_venda.sql
-- Adiciona o status "a_venda" (anunciado para venda) ao módulo de Ativos.
-- Itens "À Venda" ficam num grupo/aba próprio, fora do estoque ativo (não contam
-- no patrimônio em circulação). Usado para itens anunciados para venda antes de
-- efetivar a venda (status "vendido"). Evita duplicar o ativo só para anunciá-lo.
ALTER TABLE ativos DROP CONSTRAINT IF EXISTS ativos_status_check;
ALTER TABLE ativos ADD CONSTRAINT ativos_status_check CHECK (
  status IN (
    'em_estoque','disponivel','alocado','em_manutencao','em_transito',
    'extraviado','roubado','danificado','a_venda','baixado','descartado','vendido'
  )
);
