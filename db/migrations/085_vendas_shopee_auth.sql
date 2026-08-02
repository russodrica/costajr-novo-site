-- ============================================================================
-- 085 — Vendas: tokens da Shopee Open API
--
-- Guarda a autorização da loja na Open Platform (cadastro de desenvolvedora
-- enviado em 02/08/2026). Uma linha por loja. Os tokens ficam no banco — e
-- não em secret estático — porque o refresh token da Shopee TROCA a cada
-- renovação; um valor fixo em secret morreria na primeira renovação.
-- As chaves do App (partner id/key) essas sim ficam nos GitHub Secrets.
-- Acesso: somente service role (como as demais tabelas de vendas).
-- ============================================================================

create table if not exists vendas_shopee_auth (
  shop_id        bigint primary key,
  access_token   text,
  refresh_token  text,
  expira_em      bigint,   -- epoch (s) do vencimento do access token
  atualizado_em  bigint    -- epoch (s) da última gravação
);

notify pgrst, 'reload schema';
