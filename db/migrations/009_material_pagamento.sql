-- Migration 009: adiciona campos de Mercado Pago à manut_materiais
-- Quando o lojista vai aprovar, o sistema gera uma preference do MP
-- e armazena o ID + init_point para reuso/rastreio.

ALTER TABLE manut_materiais
  ADD COLUMN IF NOT EXISTS mercado_pago_preference_id text,
  ADD COLUMN IF NOT EXISTS mercado_pago_init_point text;
