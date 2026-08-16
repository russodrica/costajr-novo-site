-- ============================================================================
-- 107 — Vendas: registro retroativo das vendas reais do Mercado Livre
--
-- Pedido da Adriana (16/08/2026): "sincronize as vendas e informe total
-- vendido e o lucro, total e por mês". A leitura automática (`pedidos_main`)
-- segue barrada pelo 403 do PolicyAgent (permissão de Pedidos pendente no
-- DevCenter), então as 9 vendas de 20/06 a 16/08 entram aqui MANUALMENTE,
-- copiadas da tela "Detalhe da venda" da Central de Vendedores — tarifa e
-- frete REAIS de cada transação, não estimativa.
--
-- Quando a permissão sair, o robô assume: a chave única (canal, pedido_canal)
-- faz o upsert dele atualizar estas mesmas linhas sem duplicar.
--
-- Só INSERT com ON CONFLICT DO NOTHING. Nada é apagado. (db/COMO_MIGRAR.md)
-- ============================================================================

insert into vendas_pedidos
  (canal, pedido_canal, vendido_em, status_canal, comprador_nome,
   itens, valor_total, tarifa_canal, frete_canal, liquido, custo_fornecedor,
   fornecedor_status, comprado_por, observacao)
values
  -- ---- efetivadas ----------------------------------------------------------
  ('mercadolivre', '2000014555742185', '2026-08-16 12:39:00+00', 'paid', 'mario ueno',
   '[{"sku":"8429","nome":"Brinquedo Oloide Para Cães Cabo De Guerra E Estímulo Mental","quantidade":1,"preco_unitario":73.71,"custo":45.49}]'::jsonb,
   73.71, 9.21, 7.95, 56.55, 45.49,
   'a_comprar', null, 'Registro retroativo (tela do ML, 16/08). 1ª venda pós-correção de preço: lucro R$ 11,06 (15,0%). Despachar até 18/08.'),

  ('mercadolivre', '2000014533535089', '2026-08-14 18:51:00+00', 'paid', 'Ediane de Miranda Castro Dalcin',
   '[{"sku":"9266","nome":"Luva Térmica Para Cozinha E Churrasco Altas Temperaturas","quantidade":1,"preco_unitario":47.46,"custo":25.80}]'::jsonb,
   47.46, 5.46, 6.75, 35.25, 25.80,
   'a_comprar', null, 'Registro retroativo. Lucro R$ 9,45 (19,9%). Pedido de Venda 2 já criado no Bling — falta pagar na TrazPraCa (#26610940935).'),

  ('mercadolivre', '2000017925865556', '2026-08-14 01:14:00+00', 'paid', 'João',
   '[{"sku":null,"nome":"Forma Assadeira Antiaderente Quadrada 28x25cm Forneável","quantidade":1,"preco_unitario":37.85,"custo":19.36}]'::jsonb,
   37.85, 4.35, 6.85, 26.65, 19.36,
   'a_comprar', null, 'Registro retroativo. Lucro R$ 7,29 (19,3%). Pedido de Venda 3 já criado no Bling — falta pagar na TrazPraCa (#26610943773).'),

  ('mercadolivre', '2000014512437529', '2026-08-13 14:39:00+00', 'paid', 'Igor Castro',
   '[{"sku":"15786","nome":"Kit 6 Grampeadores De Metal Neon Com Base Emborrachada (SKU real 15786; a ficha do portal aponta 10262 por engano)","quantidade":1,"preco_unitario":163.40,"custo":110.90}]'::jsonb,
   163.40, 18.79, 19.85, 124.76, 110.90,
   'comprado', 'registro_retroativo', 'Registro retroativo. Lucro R$ 13,86 (8,5%) — margem baixa porque o portal tinha o custo do SKU errado (10262/almofada). Pedido já atendido via formulário.'),

  ('mercadolivre', '2000017038587066', '2026-06-21 01:42:00+00', 'delivered', null,
   '[{"sku":"10213","nome":"Produto SKU 10213 — cor da estrutura: Branco","quantidade":1,"preco_unitario":79.36,"custo":null}]'::jsonb,
   79.36, 9.13, 14.15, 56.08, null,
   'comprado', 'registro_retroativo', 'Registro retroativo (venda de 20/06, entregue). Custo do fornecedor não identificado — R$ 79,36 caiu na zona morta do frete grátis (a R$ 78,99 o líquido seria ~R$ 5,88 maior).'),

  -- ---- canceladas ----------------------------------------------------------
  ('mercadolivre', '2000014528166273', '2026-08-14 13:09:00+00', 'cancelled', null,
   '[{"sku":"8429","nome":"Brinquedo Oloide Para Cães Cabo De Guerra E Estímulo Mental","quantidade":1,"preco_unitario":49.38,"custo":45.49}]'::jsonb,
   49.38, null, null, null, 45.49,
   'nao_aplicavel', null, 'Cancelada ("não há estoque disponível"). Vendida ANTES da correção: renderia prejuízo de R$ 10,23 (-20,7%).'),

  ('mercadolivre', '2000014511983761', '2026-08-13 14:13:00+00', 'cancelled', null,
   '[{"sku":null,"nome":"Kit Vinho Com Caixa De Bambu: Saca-rolha, Corta-gotas, Bico","quantidade":1,"preco_unitario":146.60,"custo":null}]'::jsonb,
   146.60, null, null, null, null,
   'nao_aplicavel', null, 'Cancelada ("não há estoque disponível").'),

  ('mercadolivre', '2000017872763650', '2026-08-11 09:39:00+00', 'cancelled', null,
   '[{"sku":null,"nome":"Kit Vinho Com Caixa De Bambu: Saca-rolha, Corta-gotas, Bico","quantidade":1,"preco_unitario":146.60,"custo":null}]'::jsonb,
   146.60, null, null, null, null,
   'nao_aplicavel', null, 'Cancelada pelo comprador por falta de estoque (caso de 11/08).'),

  ('mercadolivre', '2000017836702074', '2026-08-09 02:44:00+00', 'cancelled', null,
   '[{"sku":"7031","nome":"Luminária Pendente Usare Millennium Falcon Star Wars (SKU 7031 era o pente pet — incidente do SKU trocado)","quantidade":1,"preco_unitario":65.50,"custo":86.02}]'::jsonb,
   65.50, null, null, null, 86.02,
   'nao_aplicavel', null, 'Cancelada. Produto real (luminária 2071, custo R$ 86,02) sem estoque; venderia a -61%. Incidente documentado em 11/08.')

on conflict (canal, pedido_canal) do nothing;

notify pgrst, 'reload schema';
