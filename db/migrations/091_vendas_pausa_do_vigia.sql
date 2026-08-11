-- ============================================================================
-- 091 — Vendas: a assinatura do vigia na pausa
--
-- O vigia pausa anúncio por três motivos (SKU trocado, sem estoque, preço
-- abaixo do custo). Quando o motivo desaparece — o produto foi remapeado, o
-- estoque voltou, o reprecificador subiu o preço — o próprio vigia devolve o
-- anúncio ao ar.
--
-- Mas ele só pode desfazer AS PRÓPRIAS pausas. Uma pausa feita pela Adriana
-- na mão é decisão dela, e decisão dela o robô não desfaz — regra antiga da
-- casa (o modo `reativar` já a respeita). Esta coluna é como o vigia
-- distingue uma coisa da outra.
--
-- Só adiciona coluna. Nada é apagado. (db/COMO_MIGRAR.md)
-- ============================================================================

alter table vendas_produtos add column if not exists pausado_pelo_vigia boolean not null default false;

comment on column vendas_produtos.pausado_pelo_vigia is
  'true = a pausa atual no ML foi do vigia (SKU trocado / sem estoque / prejuízo). Só essas ele desfaz sozinho.';

notify pgrst, 'reload schema';
