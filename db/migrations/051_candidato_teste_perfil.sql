-- 051_candidato_teste_perfil.sql
-- Teste de perfil (DISC + Eneagrama) respondido pelo candidato via link com token.
-- teste_disc / teste_eneagrama (texto) já existem — guardam o resultado-resumo.
alter table rh_candidatos add column if not exists teste_token text;
alter table rh_candidatos add column if not exists teste_disc_detalhe jsonb;
alter table rh_candidatos add column if not exists teste_eneagrama_detalhe jsonb;
alter table rh_candidatos add column if not exists teste_respondido_em timestamptz;
create unique index if not exists rh_candidatos_teste_token_uidx on rh_candidatos (teste_token) where teste_token is not null;

notify pgrst, 'reload schema';
