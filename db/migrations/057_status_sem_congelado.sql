-- 057_status_sem_congelado.sql
-- Reverte a 056: o 'congelado' VOLTA a ser status JURÍDICO separado (decisão da
-- Adriana — a pessoa precisa ficar Ativa E ter o status jurídico ao mesmo tempo).
-- O status operacional volta aos 4 valores; a pausa de alertas usa status_juridico.
alter table rh_colaboradores drop constraint if exists rh_colaboradores_status_check;
alter table rh_colaboradores add constraint rh_colaboradores_status_check
  check (status in ('ativo', 'ferias', 'afastado', 'desligado'));

notify pgrst, 'reload schema';
