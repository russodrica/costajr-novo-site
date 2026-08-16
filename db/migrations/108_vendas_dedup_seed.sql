-- ============================================================================
-- 108 — Vendas: remove as 5 duplicatas do seed manual (migration 107)
--
-- O que aconteceu (16/08/2026, ~15h30): entre escrever a 107 e ela rodar, a
-- permissão de Pedidos do Mercado Livre DESTRAVOU e o robô (pedidos_main, de
-- 2 em 2 horas) leu as vendas sozinho pela primeira vez. O ML tem duas
-- numerações para a mesma venda — a da tela do vendedor (2000014...) e a da
-- API (2000017...). O seed manual usou a da tela para 5 vendas; o robô gravou
-- as MESMAS vendas pela numeração da API. Resultado: tela de pedidos com 5
-- cartões em dobro e o "total vendido" inflado.
--
-- Este delete é cirúrgico: SÓ as 5 linhas criadas pela 107 com a numeração da
-- tela, cada uma conferida como duplicata de uma linha do robô:
--   2000014555742185 = 2000017959982488  (Oloide 16/08, R$ 73,71)
--   2000014533535089 = 2000017936804728  (Luva 14/08, R$ 47,46)
--   2000014528166273 = 2000017931084362  (Oloide cancelada 14/08)
--   2000014512437529 = 2000017914673134  (Kit Grampeadores 13/08)
--   2000014511983761 = 2000017914200236  (Kit Vinho cancelada 13/08)
-- As outras 4 linhas da 107 já usavam a numeração da API e viram a própria
-- linha do robô no upsert (chave canal+pedido_canal) — ficam.
--
-- DELETE com WHERE explícito em 5 ids, removendo apenas dados que a própria
-- migration anterior inseriu por engano. (db/COMO_MIGRAR.md)
-- ============================================================================

delete from vendas_pedidos
 where canal = 'mercadolivre'
   and pedido_canal in (
     '2000014555742185',
     '2000014533535089',
     '2000014528166273',
     '2000014512437529',
     '2000014511983761'
   );

-- O custo certo do Kit Grampeadores na linha do robô: a ficha do portal
-- aponta o SKU errado (10262/almofada, custo 13,05) e o robô herdaria esse
-- custo — a venda renderia "lucro" fantasma. O real é SKU 15786, custo
-- R$ 110,90 (planilha oficial). O robô re-sobrescreve a cada leitura
-- (CAMPOS_DO_CANAL inclui custo_fornecedor), então o conserto DEFINITIVO é a
-- ficha; até lá, este update deixa o número honesto por algumas horas e a
-- observação registra o porquê.
update vendas_pedidos
   set custo_fornecedor = 110.90,
       observacao = coalesce(observacao, '') ||
         ' [16/08: custo corrigido manualmente — ficha aponta SKU 10262 por engano; o real é 15786, custo 110,90. Corrigir a ficha!]'
 where canal = 'mercadolivre'
   and pedido_canal = '2000017914673134';

notify pgrst, 'reload schema';
