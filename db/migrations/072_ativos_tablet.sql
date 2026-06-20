-- 072_ativos_tablet.sql
-- Categoria "tablet" — separa os tablets (3G/Wi-Fi) dos demais equipamentos de
-- informática. Campos como imei1/imei2/linha/operadora seguem no jsonb ativos.campos.
alter table ativos drop constraint if exists ativos_categoria_check;
alter table ativos add constraint ativos_categoria_check
  check (categoria in ('telefonia','linha_telefonica','informatica','tablet','equipamento_obra','epi','veiculo','mobiliario','outros'));
