-- Categoria "linha_telefonica" (Linha Telefônica) — separa a LINHA/chip/plano do
-- aparelho físico. Campos específicos (linha, operadora, plano, valor_mensal, iccid,
-- pin_puk, aparelho, dia_vencimento) ficam no jsonb `ativos.campos`, como nas demais.
alter table ativos drop constraint if exists ativos_categoria_check;
alter table ativos add constraint ativos_categoria_check
  check (categoria in ('telefonia','linha_telefonica','informatica','equipamento_obra','epi','veiculo','mobiliario','outros'));
