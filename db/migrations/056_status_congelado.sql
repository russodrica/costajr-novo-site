-- 056_status_congelado.sql
-- Adiciona 'congelado' aos status permitidos do colaborador (litígio/acordo —
-- pausa férias e alertas). A coluna status_juridico (migration 055) deixa de ser
-- usada na UI (o congelado virou status operacional, por decisão da Adriana).
alter table rh_colaboradores drop constraint if exists rh_colaboradores_status_check;
alter table rh_colaboradores add constraint rh_colaboradores_status_check
  check (status in ('ativo', 'ferias', 'afastado', 'congelado', 'desligado'));

notify pgrst, 'reload schema';
