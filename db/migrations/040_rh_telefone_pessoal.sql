-- ============================================================================
-- 040 — Telefone pessoal do colaborador (alem do telefone da empresa).
--        No Monday: "CONTATO PESSOAL". O campo 'telefone' vira "telefone empresa".
-- ============================================================================

alter table rh_colaboradores add column if not exists telefone_pessoal text;
