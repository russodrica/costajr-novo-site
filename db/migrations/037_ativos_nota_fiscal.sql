-- ============================================================================
-- 037 — Nota fiscal do ativo em cofre PRIVADO (LGPD)
--        Coluna para o caminho no bucket privado `ativos-docs`.
--        O bucket é criado via Storage API (service role) — ver scripts.
-- ============================================================================

alter table ativos add column if not exists nota_fiscal_path text;
