-- ============================================================================
-- 101 — Vendas: o cofre do token do Mercado Livre
--
-- Por que existe (15/08/2026): a autorização do app "TrazPraCa Automacao" foi
-- revogada junto com o descadastro das integrações do ML, e a rodada inteira
-- do dia caiu com 400 no /oauth/token. O refresh token morava num secret
-- ESTÁTICO do GitHub — e o ML rotaciona refresh tokens: cada uso pode devolver
-- um novo. Secret estático envelhece; tabela não.
--
-- A partir daqui o token vive nesta tabela (mesmo desenho da
-- vendas_shopee_auth, migration 085): o robô lê daqui, e a cada renovação
-- grava de volta o refresh novo. O secret ML_REFRESH_TOKEN vira só o
-- fallback de primeira carga.
--
-- Segurança: service_role apenas — RLS ligado sem policy pública.
--
-- Só cria tabela. Nada é apagado. (db/COMO_MIGRAR.md)
-- ============================================================================

create table if not exists vendas_ml_auth (
  id            text primary key default 'default',
  refresh_token text not null,
  access_token  text,
  user_id       bigint,
  expira_em     timestamptz,
  atualizado_em timestamptz not null default now()
);

alter table vendas_ml_auth enable row level security;

comment on table vendas_ml_auth is
  'Tokens OAuth do app TrazPraCa Automacao no ML. O refresh rotaciona a cada uso; por isso mora aqui e não em secret estático.';

notify pgrst, 'reload schema';
