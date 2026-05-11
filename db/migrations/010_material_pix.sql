-- Migration 010: campo Pix do Mercado Pago para materiais
-- Armazena { payment_id, qr_code, qr_code_base64, ticket_url }
-- gerados pela API /v1/payments do MP quando o cliente abre o modal de aprovação.

ALTER TABLE manut_materiais
  ADD COLUMN IF NOT EXISTS mercado_pago_pix jsonb;
