-- 053_ferias_abono.sql
-- Abono pecuniário ("vender" parte das férias): dias vendidos reduzem o descanso
-- a programar. dias_abono ∈ {0,10,15,20,30}. (CLT: limite legal = 1/3 = 10 dias;
-- as demais opções ficam disponíveis a critério do RH.)
alter table rh_ferias_periodos add column if not exists dias_abono int not null default 0;

notify pgrst, 'reload schema';
