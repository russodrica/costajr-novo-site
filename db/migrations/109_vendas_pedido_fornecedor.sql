-- ============================================================================
-- 109 — Vendas: situação do pedido no fornecedor e rastreio, lidos sozinhos
--
-- Pedido da Adriana (16/08/2026): "consegue integrar no TrazPraCa o que já foi
-- comprado e atualizar sozinho, bem como se já foi enviado?".
--
-- Até agora `fornecedor_status` só mudava quando ela clicava "Já comprei na
-- TrazPraCa" — trabalho manual, e o portal não sabia se o fornecedor já tinha
-- despachado. A tela `/pedidos-marketplaces` da TrazPraCa tem a resposta das
-- duas perguntas: o pedido aparece lá quando foi comprado, com SITUAÇÃO
-- (EM ANDAMENTO / EMPACOTANDO / ATENDIDO / DELETADO) e o CÓDIGO DA ETIQUETA
-- quando o pacote sai. `src/trazpraca_pedidos.py` lê essa tela e preenche
-- estas colunas.
--
-- `fornecedor_status` (a_comprar/comprado/nao_aplicavel) continua sendo a
-- decisão — e a tela dela continua podendo sobrescrever. Estas colunas são o
-- DETALHE observado no fornecedor, que ninguém digita.
--
-- Só ADD COLUMN IF NOT EXISTS. Nada é apagado. (db/COMO_MIGRAR.md)
-- ============================================================================

alter table vendas_pedidos add column if not exists fornecedor_situacao text;
alter table vendas_pedidos add column if not exists fornecedor_rastreio text;
alter table vendas_pedidos add column if not exists fornecedor_enviado_em timestamptz;
alter table vendas_pedidos add column if not exists fornecedor_visto_em timestamptz;

comment on column vendas_pedidos.fornecedor_situacao is
  'Situação crua na tela /pedidos-marketplaces da TrazPraCa: EM ANDAMENTO | EMPACOTANDO | ATENDIDO | DELETADO. Lida por src/trazpraca_pedidos.py; ninguém digita.';
comment on column vendas_pedidos.fornecedor_rastreio is
  'Código da etiqueta no fornecedor. Preenchido quando o pacote é despachado.';
comment on column vendas_pedidos.fornecedor_enviado_em is
  'Quando o robô viu o pedido como ATENDIDO/despachado pela primeira vez.';
comment on column vendas_pedidos.fornecedor_visto_em is
  'Última vez que este pedido foi encontrado na tela do fornecedor.';

-- A tela abre pelo que falta comprar; agora também precisa achar rápido o que
-- está comprado mas ainda não despachado.
create index if not exists vendas_pedidos_situacao_idx
  on vendas_pedidos (fornecedor_situacao, vendido_em desc);

notify pgrst, 'reload schema';
