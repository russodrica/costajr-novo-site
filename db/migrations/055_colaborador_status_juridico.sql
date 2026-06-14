-- 055_colaborador_status_juridico.sql
-- Status jurídico do colaborador. Quando "congelado" (ex.: litígio/acordo
-- trabalhista em andamento), a programação de férias e os demais alertas
-- automáticos ficam PAUSADOS para esse colaborador.
--   normal       → sem pendência jurídica (padrão; recebe alertas)
--   em_processo  → processo em andamento (ainda recebe alertas)
--   congelado    → alertas e programação de férias PAUSADOS
alter table rh_colaboradores add column if not exists status_juridico text not null default 'normal';

notify pgrst, 'reload schema';
