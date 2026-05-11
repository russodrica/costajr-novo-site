-- Migration 012: preço unitário + fluxo de reposição (Pix ou compra na próxima visita)

ALTER TABLE manut_estoque
  ADD COLUMN IF NOT EXISTS preco_unitario numeric(10,2);

ALTER TABLE manut_estoque_movimentos
  ADD COLUMN IF NOT EXISTS reposicao_metodo text,
  ADD COLUMN IF NOT EXISTS reposicao_valor numeric(10,2),
  ADD COLUMN IF NOT EXISTS reposicao_mp_pix jsonb,
  ADD COLUMN IF NOT EXISTS reposto_em timestamptz;

-- Permite todos os estados do fluxo novo
ALTER TABLE manut_estoque_movimentos
  DROP CONSTRAINT IF EXISTS manut_estoque_movimentos_reposicao_status_check;
ALTER TABLE manut_estoque_movimentos
  ADD CONSTRAINT manut_estoque_movimentos_reposicao_status_check
  CHECK (reposicao_status IN (
    'nao_solicitada',
    'solicitada',
    'pagamento_pendente',
    'pago',
    'aguardando_visita',
    'atendida',
    'recusada'
  ));

-- CHECK do metodo (NULL ate o cliente escolher)
ALTER TABLE manut_estoque_movimentos
  DROP CONSTRAINT IF EXISTS manut_estoque_movimentos_metodo_check;
ALTER TABLE manut_estoque_movimentos
  ADD CONSTRAINT manut_estoque_movimentos_metodo_check
  CHECK (reposicao_metodo IS NULL OR reposicao_metodo IN ('pix','proxima_visita'));
