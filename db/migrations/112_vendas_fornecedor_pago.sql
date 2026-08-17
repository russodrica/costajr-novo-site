-- 112 — Vendas: o que a Adriana PAGOU de fato em cada pedido do fornecedor
--
-- 17/08/2026: a TrazPraCa confirmou que a cobrança do pedido na plataforma
-- deles deve ser SÓ o custo do produto — e a automação deles já cobrou
-- errado (pedido #26622148877: R$ 50,02 por um produto de R$ 26,72; a
-- Lixeira Pedal 15L saiu por R$ 49,13 com ficha de R$ 45,63). Pedido dela:
-- "eu preciso conferir se as coisas que eu paguei estavam corretas".
--
-- O robô de pedidos (trazpraca_pedidos) lê o "PAGAMENTO Valor: R$ -xx,xx"
-- da tela do fornecedor e grava aqui; o painel compara com custo_fornecedor
-- e marca divergência para contestar.
--
-- Só adiciona coluna. Nada é apagado. (db/COMO_MIGRAR.md)

alter table vendas_pedidos add column if not exists fornecedor_pago numeric(12,2);

comment on column vendas_pedidos.fornecedor_pago is
  'Valor efetivamente pago à TrazPraCa neste pedido (lido da tela deles). Deve ser igual ao custo do produto; diferença é cobrança errada do fornecedor.';

notify pgrst, 'reload schema';
