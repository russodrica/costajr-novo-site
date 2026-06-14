-- ============================================================================
-- 047 — Quadro do candidato (campos do app PowerApps "Gestão de pessoas")
--   Enriquece rh_candidatos com o perfil completo: dados pessoais, experiência,
--   formação, disponibilidades, personalidade, Teste DISC e Eneagrama, currículo.
-- ============================================================================

alter table rh_candidatos add column if not exists data_nascimento date;
alter table rh_candidatos add column if not exists experiencia text;
alter table rh_candidatos add column if not exists formacao text;
alter table rh_candidatos add column if not exists conhecimento_tecnologico text;
alter table rh_candidatos add column if not exists possui_habilitacao boolean;
alter table rh_candidatos add column if not exists possui_veiculo boolean;
alter table rh_candidatos add column if not exists disp_imediata boolean;
alter table rh_candidatos add column if not exists disp_viagem boolean;
alter table rh_candidatos add column if not exists disp_presencial boolean;
alter table rh_candidatos add column if not exists personalidade text;
alter table rh_candidatos add column if not exists restricao text;
alter table rh_candidatos add column if not exists teste_disc text;
alter table rh_candidatos add column if not exists teste_eneagrama text;
alter table rh_candidatos add column if not exists curriculo_url text;
