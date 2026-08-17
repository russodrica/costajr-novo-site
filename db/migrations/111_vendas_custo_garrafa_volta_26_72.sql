-- 111: desfaz a 110 — o custo da Garrafa 780ml Preta volta a R$ 26,72
--
-- 17/08/2026, tarde: a Adriana tirou a dúvida com a TrazPraCa. O pagamento
-- do pedido na plataforma deles tem que ser SÓ o custo do produto (R$ 26,72,
-- como diz o card da vitrine). Os R$ 50,02 cobrados no pedido #26622148877
-- eram ERRO da automação da TrazPraCa — não eram frete embutido nem preço
-- novo. Palavras dela: "eles fizeram uma automação errada... retifica aquilo
-- que você fez".
--
-- Com o custo certo, a auditoria da próxima leva desce o preço do anúncio
-- (hoje em R$ 78,87 por causa do custo inflado) de volta ao alvo de 18%.

update vendas_produtos
   set custo          = 26.72,
       custo_planilha = 26.72,
       updated_at     = now()
 where sku_trazpraca = '6365'
   and ml_item_id    = 'MLB7345544062'
   and custo is distinct from 26.72;
