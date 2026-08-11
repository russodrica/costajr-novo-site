-- ============================================================================
-- 089 — Vendas: o log do vigia de estoque e custo
--
-- Por que existe (11/08/2026): duas vendas de agosto não foram atendidas
-- porque o produto tinha ficado sem estoque na TrazPraCa e ninguém reconferiu
-- depois de publicar. A luminária SKU 7031 estava no ar por R$ 65,50 com custo
-- de R$ 86,02 — prejuízo E sem estoque ao mesmo tempo.
--
-- O scanner só olha produto NOVO, em estoque e fora da loja; quem já está
-- publicado é filtrado fora de propósito. O vigia (src/vigia_main.py) faz o
-- contrário: varre o catálogo e confere justamente os publicados, pausa no ML
-- o que ficou sem estoque e avisa o que está abaixo do custo.
--
-- Esta migration só abre espaço para ele no log e guarda quando o custo de
-- cada produto foi conferido pela última vez — sem essa data não dá para
-- distinguir "custo certo" de "custo que ninguém olha há um mês".
--
-- Só adiciona coluna e troca check. Nada é apagado. (db/COMO_MIGRAR.md)
-- ============================================================================

alter table vendas_produtos add column if not exists custo_visto_em timestamptz;

comment on column vendas_produtos.custo_visto_em is
  'Quando o vigia conferiu este custo na vitrine da TrazPraCa pela última vez.';

-- A lista anterior é repetida inteira de propósito — o `check` é substituído,
-- não somado. (Mesmo padrão das migrations 080, 082 e 088.)
alter table vendas_sync_log drop constraint if exists vendas_sync_log_tipo_check;
alter table vendas_sync_log add constraint vendas_sync_log_tipo_check
  check (tipo in ('scan_novos','preco_ml','preco_shopee','saldo_trazpraca',
                  'validador_preco','enriquecimento','carga_catalogo',
                  'publicacao_ml','publicacao_shopee','estoque','inventario',
                  'pedidos','vigia'));

notify pgrst, 'reload schema';
