-- ============================================================================
-- 025 — Integração D4Sign (assinatura eletrônica)
-- Termos de responsabilidade podem ser enviados para assinatura via D4Sign.
-- ============================================================================

alter table ativos_termos add column if not exists d4sign_uuid text;
alter table ativos_termos add column if not exists d4sign_status text;
alter table ativos_termos add column if not exists d4sign_enviado_em timestamptz;
alter table ativos_termos add column if not exists d4sign_finalizado_em timestamptz;

create index if not exists idx_ativos_termos_d4sign on ativos_termos(d4sign_uuid);
