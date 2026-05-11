-- Migration 006: relação N:N entre técnicos e lojas
-- Um técnico pode atender várias lojas. Uma loja pode ter vários técnicos.
-- O técnico vê chamados/preventivas de TODAS as lojas vinculadas (além das atribuídas diretamente a ele).
-- Rodar no Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS manut_tecnico_lojas (
  tecnico_id text NOT NULL REFERENCES manut_tecnicos(id) ON DELETE CASCADE,
  loja_id text NOT NULL REFERENCES manut_lojas(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tecnico_id, loja_id)
);

CREATE INDEX IF NOT EXISTS idx_manut_tecnico_lojas_tecnico ON manut_tecnico_lojas(tecnico_id);
CREATE INDEX IF NOT EXISTS idx_manut_tecnico_lojas_loja    ON manut_tecnico_lojas(loja_id);
