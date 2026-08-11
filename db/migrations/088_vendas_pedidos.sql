-- ============================================================================
-- 088 — Vendas: pedidos dos marketplaces (a ponte que o Bling fazia)
--
-- Por que existe (11/08/2026): a TrazPraCa tem a tela `/pedidos-marketplaces`,
-- mas ela só se alimenta pelo Bling — `/produtos-integracoes` diz, em letras
-- grandes, "Não conectado com a Conta do Bling". O último pedido capturado por
-- lá é de 21/06/2026, exatamente quando a Adriana saiu do Bling. Resultado: a
-- venda de 08/08 (luminária Millennium Falcon) nunca virou pedido ao
-- fornecedor, e a de 11/08 (kit vinho) foi cancelada pelo comprador por falta
-- de estoque. Duas vendas, nenhuma atendida.
--
-- Esta tabela é o meio da ponte. De um lado o robô lê as vendas no Mercado
-- Livre e grava aqui tudo que o formulário `/pedidos-cadastro` da TrazPraCa
-- pede (cliente, documento, endereço completo, marketplace, produtos). Do
-- outro, a tela `/admin/vendas/pedidos` mostra o pedido pronto para copiar.
--
-- O que a tabela NÃO faz, de propósito: comprar. Cadastrar e pagar o pedido no
-- fornecedor é dinheiro saindo, e continua sendo ato da Adriana — o robô
-- prepara, ela confirma. Mesma regra da aprovação de anúncios.
--
-- Só cria tabela e índice. Nada é apagado. (db/COMO_MIGRAR.md)
-- ============================================================================

create table if not exists vendas_pedidos (
  -- `text` e não `uuid` de propósito: é o padrão das outras tabelas de vendas
  -- (078), e o portal filtra por id em URL do PostgREST.
  id text primary key default gen_random_uuid()::text,

  -- De onde veio a venda. 'mercadolivre' | 'shopee' — os mesmos nomes que o
  -- formulário da TrazPraCa usa no passo "Marketplace", para copiar sem
  -- traduzir nada.
  canal text not null default 'mercadolivre',

  -- Número da venda no canal (#2000017836702074 no ML). É a chave natural:
  -- a rodada roda de hora em hora e não pode duplicar pedido.
  pedido_canal text not null,

  vendido_em timestamptz,
  status_canal text,              -- paid, cancelled, shipped... como o canal diz
  prazo_despacho timestamptz,     -- até quando o ML exige o despacho

  -- Cliente, exatamente os campos do passo 1 do formulário deles.
  comprador_nome text,
  comprador_documento text,
  comprador_apelido text,
  comprador_celular text,

  -- Endereço, exatamente os campos do passo 2.
  entrega_cep text,
  entrega_rua text,
  entrega_numero text,
  entrega_complemento text,
  entrega_bairro text,
  entrega_cidade text,
  entrega_estado text,
  entrega_recebedor text,

  -- Itens: [{sku, nome, quantidade, preco_unitario, ml_item_id, custo}]
  itens jsonb not null default '[]'::jsonb,

  valor_total numeric(12,2),
  tarifa_canal numeric(12,2),
  frete_canal numeric(12,2),
  liquido numeric(12,2),
  custo_fornecedor numeric(12,2),   -- soma dos custos da ficha, para conferir a carteira

  -- O estado da compra no fornecedor. Este é o único campo que a TELA muda —
  -- o robô nunca o sobrescreve numa re-leitura.
  --   a_comprar      chegou a venda, o pedido no fornecedor ainda não foi feito
  --   comprado       a Adriana cadastrou e pagou na TrazPraCa
  --   nao_aplicavel  venda cancelada, ou produto que não vem da TrazPraCa
  fornecedor_status text not null default 'a_comprar'
    check (fornecedor_status in ('a_comprar', 'comprado', 'nao_aplicavel')),
  fornecedor_pedido text,          -- número do pedido lá, quando ela tiver
  comprado_em timestamptz,
  comprado_por text,
  observacao text,

  criado_em timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A trava contra pedido duplicado. Sem ela, uma rodada repetida viraria duas
-- compras no fornecedor — erro que custa dinheiro de verdade.
create unique index if not exists vendas_pedidos_canal_numero_uk
  on vendas_pedidos (canal, pedido_canal);

-- A tela abre sempre pelo que falta comprar.
create index if not exists vendas_pedidos_status_idx
  on vendas_pedidos (fornecedor_status, vendido_em desc);

-- O log ganha o tipo da rodada nova, e o alerta ganha o aviso que faltou em
-- 08/08: "vendeu e o pedido no fornecedor ainda não foi feito". A lista
-- anterior é repetida inteira de propósito — o `check` é substituído, não
-- somado. (Mesmo padrão das migrations 080 e 082.)
alter table vendas_sync_log drop constraint if exists vendas_sync_log_tipo_check;
alter table vendas_sync_log add constraint vendas_sync_log_tipo_check
  check (tipo in ('scan_novos','preco_ml','preco_shopee','saldo_trazpraca',
                  'validador_preco','enriquecimento','carga_catalogo',
                  'publicacao_ml','publicacao_shopee','estoque','inventario',
                  'pedidos'));

alter table vendas_alertas drop constraint if exists vendas_alertas_tipo_check;
alter table vendas_alertas add constraint vendas_alertas_tipo_check
  check (tipo in ('preco_anomalo','estoque_zerado','saldo_trazpraca_baixo',
                  'sync_falhou','custo_subiu','custo_caiu','ficha_incompleta',
                  'publicacao_falhou','pedido_a_comprar'));

comment on table  vendas_pedidos is 'Vendas dos marketplaces prontas para virar pedido na TrazPraCa. Alimentada por src/pedidos_main.py; a compra em si continua sendo ato da Adriana.';
comment on column vendas_pedidos.fornecedor_status is 'a_comprar | comprado | nao_aplicavel. Único campo que a tela muda — o robô nunca sobrescreve numa re-leitura.';

notify pgrst, 'reload schema';
