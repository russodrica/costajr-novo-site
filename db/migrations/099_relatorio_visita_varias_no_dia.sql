-- 099_relatorio_visita_varias_no_dia.sql
--
-- Mais de um Relatório de Visita por obra no mesmo dia.
--
-- A tabela nasceu como DIÁRIO de obra, onde "um por obra por dia" é a regra
-- certa: existe um dia de trabalho só. Com o Relatório de VISITA a lógica é
-- outra — pode haver duas visitas no mesmo dia, e o relatório é do evento, não
-- do calendário.
--
-- O efeito prático da regra antiga era ruim de entender: ao pedir um relatório
-- novo na mesma data, o sistema devolvia o que já existia, e a tela abria
-- "preenchida sozinha". Some a regra, some a confusão.

alter table obras_rdo drop constraint if exists obras_rdo_obra_id_data_key;
drop index if exists idx_obras_rdo_fundacao_data;

-- os índices continuam, agora só para busca (sem unicidade)
create index if not exists idx_obras_rdo_obra_data on obras_rdo(obra_id, data desc);
create index if not exists idx_obras_rdo_fundacao_data on obras_rdo(fundacao_id, data desc);
