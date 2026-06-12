-- ============================================================================
-- 026 — Sincronização RH com Monday + documentos em storage PRIVADO
-- Arquivos de RH (RG, CNH, ASO, contratos) contêm dados pessoais sensíveis
-- (LGPD): ficam no bucket privado "rh" e só saem por URL assinada gerada
-- para admins autenticados.
-- ============================================================================

alter table rh_colaboradores add column if not exists monday_id text unique;
alter table rh_documentos add column if not exists monday_asset_id text unique;
alter table rh_documentos add column if not exists storage_path text;
