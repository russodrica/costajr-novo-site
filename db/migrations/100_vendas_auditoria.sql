-- ============================================================================
-- 100 — Vendas: quando este anúncio teve o lucro conferido pela última vez
--
-- Por que existe (14/08/2026): o Brinquedo Oloide vendeu por R$ 49,38 com
-- custo de R$ 45,49. O vigia não pausou porque a régua dele era
-- **preço < custo** — e R$ 49,38 é maior que R$ 45,49. A tela do Mercado
-- Livre mostra a conta inteira: comissão R$ 6,17 + custo operacional R$ 7,95,
-- "Você recebe R$ 35,26". Prejuízo de R$ 10,23 por venda, com 105 unidades
-- em estoque prontas para repetir.
--
-- "Acima do custo" e "com lucro" não são a mesma coisa. A auditoria
-- (src/auditoria_ml.py) confere a segunda coisa, com as taxas que o próprio
-- ML informa, e pausa quem estiver no vermelho. Esta coluna é a data dessa
-- conferência — sem ela não dá para distinguir "auditado hoje" de "ninguém
-- olha há um mês".
--
-- Só adiciona coluna. Nada é apagado. (db/COMO_MIGRAR.md)
-- ============================================================================

alter table vendas_produtos add column if not exists auditado_em timestamptz;

comment on column vendas_produtos.auditado_em is
  'Quando a auditoria conferiu o lucro real deste anúncio (taxas do ML + frete + custo da planilha).';

notify pgrst, 'reload schema';
