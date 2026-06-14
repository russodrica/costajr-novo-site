-- ============================================================================
-- 043 — "Vencimento não aplicável" nos documentos de RH
--   Permite marcar um documento como SEM vencimento (N/A), distinto de
--   "ainda não informado". Quando há validade (data), o cron envia lembretes;
--   quando validade_na = true, nao cobra nem alerta.
-- ============================================================================

alter table rh_documentos add column if not exists validade_na boolean not null default false;
