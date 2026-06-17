-- Migration 066: revogação real de sessão (token_version)
-- ============================================================================
-- PROBLEMA (revisão de segurança jun/2026): o JWT do portal/admin vale 7 dias e
-- NADA re-checa o estado do usuário a cada request. Resultado: ao DESLIGAR alguém
-- (ou resetar a senha de uma conta comprometida), o token JÁ emitido continua
-- válido por dias — a "revogação de acesso" não revogava de fato.
--
-- SOLUÇÃO: cada portal_profile ganha um `token_version`. O login embute o valor
-- atual no JWT (claim `tv`). A cada request autenticada, o servidor compara o `tv`
-- do token com o do banco; se diferirem, a sessão foi revogada -> 401. Incrementar
-- o token_version (ao desligar / resetar senha) invalida na hora TODOS os tokens
-- daquele usuário. Fail-open: erro de leitura nunca derruba acesso (só divergência).
--
-- ➜ Rodar UMA vez no Supabase SQL Editor. Idempotente.
-- ============================================================================

alter table if exists public.portal_profiles
  add column if not exists token_version integer not null default 0;
