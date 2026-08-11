-- ============================================================================
-- 090 — Vendas: o alerta de SKU trocado
--
-- Por que existe (11/08/2026): o anúncio "Luminária Millennium Falcon"
-- (vendido a R$ 65,50) estava cadastrado com o SKU 7031 — que na TrazPraCa é
-- um pente de massagem para pets, custo R$ 13,70. A luminária de verdade é o
-- id 2071: custo R$ 86,02, sem estoque. Toda a régua de margem rodou em cima
-- da ficha errada e aprovou um prejuízo de R$ 40 por unidade.
--
-- O vigia agora compara o nome da ficha com o nome do anúncio e pausa o que
-- não bate. Este tipo de alerta é a etiqueta desse achado — a lista anterior
-- é repetida inteira de propósito, o `check` é substituído, não somado
-- (mesmo padrão das migrations 080, 082, 088 e 089).
--
-- Só troca check. Nada é apagado. (db/COMO_MIGRAR.md)
-- ============================================================================

alter table vendas_alertas drop constraint if exists vendas_alertas_tipo_check;
alter table vendas_alertas add constraint vendas_alertas_tipo_check
  check (tipo in ('preco_anomalo','estoque_zerado','saldo_trazpraca_baixo',
                  'sync_falhou','custo_subiu','custo_caiu','ficha_incompleta',
                  'publicacao_falhou','pedido_a_comprar','sku_trocado'));

notify pgrst, 'reload schema';
