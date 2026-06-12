-- ============================================================================
-- 024 — Sincronização com a Vobi
-- Colunas de rastreio para importar dados da API Vobi de forma idempotente
-- (rodar o script de migração várias vezes não duplica nada).
-- ============================================================================

alter table fin_categorias add column if not exists vobi_id text unique;
alter table fin_lancamentos add column if not exists vobi_id text unique;
alter table obras add column if not exists vobi_id text unique;

create index if not exists idx_fin_lanc_vobi on fin_lancamentos(vobi_id);
