-- 058_status_com_congelado.sql
-- Decisão FINAL da Adriana: um ÚNICO status, com 'congelado' (jurídico) na lista
-- (é algo raro). A pausa de alertas usa status==='congelado'. Constraint volta a
-- aceitar congelado. (status_juridico da migration 055 fica vestigial, sem uso.)
alter table rh_colaboradores drop constraint if exists rh_colaboradores_status_check;
alter table rh_colaboradores add constraint rh_colaboradores_status_check
  check (status in ('ativo', 'ferias', 'afastado', 'congelado', 'desligado'));

notify pgrst, 'reload schema';
