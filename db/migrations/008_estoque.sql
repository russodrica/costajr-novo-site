-- Migration 008: estoque de materiais por loja + movimentações
-- Cada loja tem seu kit de itens (cabos, lâmpadas, vedações...).
-- Durante a preventiva o técnico dá baixa nos usados e pode adicionar item novo.
-- O lojista vê tudo no painel do cliente e pode solicitar reposição.

CREATE TABLE IF NOT EXISTS manut_estoque (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  loja_id text NOT NULL REFERENCES manut_lojas(id) ON DELETE CASCADE,
  nome text NOT NULL,
  unidade text NOT NULL DEFAULT 'un',
  quantidade_atual numeric(10,2) NOT NULL DEFAULT 0,
  quantidade_minima numeric(10,2) NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_manut_estoque_loja ON manut_estoque(loja_id);

CREATE TABLE IF NOT EXISTS manut_estoque_movimentos (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  estoque_id text NOT NULL REFERENCES manut_estoque(id) ON DELETE CASCADE,
  loja_id text NOT NULL REFERENCES manut_lojas(id) ON DELETE CASCADE,
  preventiva_id text REFERENCES manut_preventivas(id) ON DELETE SET NULL,
  tecnico_id text REFERENCES manut_tecnicos(id) ON DELETE SET NULL,
  tipo text NOT NULL CHECK (tipo IN ('baixa','adicao','reposicao')),
  quantidade numeric(10,2) NOT NULL,
  observacao text,
  reposicao_status text NOT NULL DEFAULT 'nao_solicitada'
    CHECK (reposicao_status IN ('nao_solicitada','solicitada','atendida','recusada')),
  reposicao_solicitada_em timestamptz,
  reposicao_atendida_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_manut_estoque_mov_estoque    ON manut_estoque_movimentos(estoque_id);
CREATE INDEX IF NOT EXISTS idx_manut_estoque_mov_loja       ON manut_estoque_movimentos(loja_id);
CREATE INDEX IF NOT EXISTS idx_manut_estoque_mov_preventiva ON manut_estoque_movimentos(preventiva_id);
CREATE INDEX IF NOT EXISTS idx_manut_estoque_mov_reposicao  ON manut_estoque_movimentos(reposicao_status);
