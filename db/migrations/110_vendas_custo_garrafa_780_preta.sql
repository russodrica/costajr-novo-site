-- 110: corrige o custo da Garrafa com Alça e Bico 780ml em Aço Inox Preta
--
-- 17/08/2026: a venda do pedido TrazPraCa #26622148877 saiu no prejuízo
-- (~-R$ 8): o anúncio MLB7345544062 vendeu a R$ 56,28 e o custo real na
-- TrazPraCa é R$ 50,02 — mas a ficha no portal dizia custo R$ 26,72.
-- A ficha está "não encontrada" na vitrine (produto renumerado pela
-- TrazPraCa), então o vigia não tem de onde reler o custo; o valor real
-- veio do próprio pedido que a Adriana pagou. Com o custo certo, a
-- auditoria horária reprecifica (ou pausa) o anúncio sozinha.
--
-- O card da vitrine ainda mostra "Custo R$ 26,72", mas o rótulo da vitrine
-- já provou que mente (ver doc "a ficha mente", 13/08) — o que vale é o que
-- o caixa cobra: R$ 50,02. Grava também em custo_planilha porque a auditoria
-- prefere custo_planilha quando existe (e a planilha ter/sex não traz SKUs
-- renumerados, então nunca vai corrigir sozinha).
--
-- Update cirúrgico: uma ficha só, identificada por SKU + anúncio.

update vendas_produtos
   set custo          = 50.02,
       custo_planilha = 50.02,
       updated_at     = now()
 where sku_trazpraca = '6365'
   and ml_item_id    = 'MLB7345544062'
   and custo is distinct from 50.02;
