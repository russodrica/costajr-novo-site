-- ============================================================================
-- 092 — Vendas: a ficha oficial do fornecedor
--
-- Por que existe (13/08/2026): ao preencher o formulário de pedido da
-- TrazPraCa para a venda do Kit 6 Grampeadores, o campo CÓDIGO (SKU) foi
-- conferido na "planilha geral" deles. O número que o portal guardava —
-- 10262 — lá é **Almofada Quadrada Profissões – Odontologia**, custo
-- R$ 13,05. O Kit 6 Grampeadores é o SKU **15786**, custo R$ 110,90.
--
-- São duas numerações diferentes e o portal guardou a errada no catálogo
-- inteiro: `sku_trazpraca` é o id da PÁGINA
-- (`/produtos-marketplace/id/10262`), não o código do catálogo. Todo pedido
-- gerado a partir do portal pediria o produto errado — a mesma classe de erro
-- da luminária SKU 7031, que na TrazPraCa era um pente de massagem para pets.
--
-- Estas colunas guardam a ficha como o FORNECEDOR a publica, na planilha
-- geral (que é legível sem login). São o dado que manda numa divergência:
--
--   sku_fornecedor  — o código que o pedido usa. Sem ele, não se pede nada.
--   ean             — a chave estável entre os dois lados (a loja expõe o
--                     mesmo EAN num input hidden). É por ele que se casa.
--   prazo_envio_dias— "TEMPO DE ENVIO (DIAS ÚTEIS)". O Kit 6 Grampeadores é
--                     D+2 e o anúncio prometia despacho em D+1: a venda
--                     nasceu atrasada. Com este número o anúncio pode
--                     declarar o prazo que o fornecedor cumpre.
--   custo_planilha  — o custo oficial, para conferir contra o que o scanner
--                     leu da vitrine. Divergência vira alerta, não silêncio.
--   estoque_planilha, fabricante, peso_planilha_kg — o resto da ficha.
--
-- Só adiciona coluna e troca check. Nada é apagado. (db/COMO_MIGRAR.md)
-- ============================================================================

alter table vendas_produtos add column if not exists sku_fornecedor    text;
alter table vendas_produtos add column if not exists ean               text;
alter table vendas_produtos add column if not exists prazo_envio_dias  integer;
alter table vendas_produtos add column if not exists custo_planilha    numeric(10,2);
alter table vendas_produtos add column if not exists estoque_planilha  integer;
alter table vendas_produtos add column if not exists fabricante        text;
alter table vendas_produtos add column if not exists peso_planilha_kg  numeric(10,3);
alter table vendas_produtos add column if not exists planilha_visto_em timestamptz;

comment on column vendas_produtos.sku_fornecedor is
  'CÓDIGO (SKU) da planilha geral da TrazPraCa — o número que o PEDIDO usa. Diferente de sku_trazpraca, que é o id da página do produto.';
comment on column vendas_produtos.ean is
  'Código de barras. Chave estável entre a planilha do fornecedor e a loja.';
comment on column vendas_produtos.prazo_envio_dias is
  'TEMPO DE ENVIO em dias úteis (D+N). O tempo de manuseio do anúncio não pode prometer menos que isto.';
comment on column vendas_produtos.custo_planilha is
  'Custo na planilha oficial do fornecedor. Diverge do custo lido da vitrine? Este manda, e a divergência vira alerta.';
comment on column vendas_produtos.planilha_visto_em is
  'Quando esta ficha foi conferida na planilha geral pela última vez.';

create index if not exists vendas_produtos_ean_idx on vendas_produtos (ean);
create index if not exists vendas_produtos_sku_fornecedor_idx on vendas_produtos (sku_fornecedor);

-- A lista anterior é repetida inteira de propósito — o `check` é substituído,
-- não somado. (Mesmo padrão das migrations 080, 082, 088, 089 e 090.)
alter table vendas_sync_log drop constraint if exists vendas_sync_log_tipo_check;
alter table vendas_sync_log add constraint vendas_sync_log_tipo_check
  check (tipo in ('scan_novos','preco_ml','preco_shopee','saldo_trazpraca',
                  'validador_preco','enriquecimento','carga_catalogo',
                  'publicacao_ml','publicacao_shopee','estoque','inventario',
                  'pedidos','vigia','planilha','auditoria'));

alter table vendas_alertas drop constraint if exists vendas_alertas_tipo_check;
alter table vendas_alertas add constraint vendas_alertas_tipo_check
  check (tipo in ('preco_anomalo','estoque_zerado','saldo_trazpraca_baixo',
                  'sync_falhou','custo_subiu','custo_caiu','ficha_incompleta',
                  'publicacao_falhou','pedido_a_comprar','sku_trocado',
                  'sku_fornecedor_ausente','custo_diverge_da_planilha',
                  'prazo_incompativel','margem_abaixo_do_piso'));

notify pgrst, 'reload schema';
