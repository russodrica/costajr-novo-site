-- 114 — Vendas: estado da etiqueta/declaração de conteúdo no fornecedor
--
-- "O pedido fica parado se não emite essa declaração de conteúdo... precisa
-- automatizar para que seja emitida assim que for liberado" (Adriana, 17/08).
-- A investigação no site da TrazPraCa mostrou: o modal "Etiquetas" de cada
-- pedido consulta a logística e hoje devolve "não possuem logística
-- cadastrada" — o estado parado. O robô passa a vigiar de hora em hora e
-- gravar aqui a mudança; quando liberar, guarda também o HTML do modal
-- (etiqueta_modal) para ligarmos a emissão automática no passo seguinte.
--
-- Só acrescenta colunas. Nada é apagado. (db/COMO_MIGRAR.md)

alter table vendas_pedidos
  add column if not exists etiqueta_status   text,
  add column if not exists etiqueta_visto_em timestamptz,
  add column if not exists etiqueta_modal    text;

comment on column vendas_pedidos.etiqueta_status is
  'aguardando_logistica | liberada | vazio — visto pelo robo no modal Etiquetas da TrazPraCa';

notify pgrst, 'reload schema';
