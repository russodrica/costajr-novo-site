-- ============================================================================
-- 080 — Vendas: ficha completa do produto e rascunho do anúncio
--
-- Motivo: até aqui vendas_produtos guardava só o suficiente para CALCULAR
-- preço (nome, custo, sugerido, estoque). Para PUBLICAR no Mercado Livre e na
-- Shopee falta a ficha inteira: descrição, características, fotos em alta,
-- peso e dimensões (frete), e os atributos que o ML exige (marca, modelo,
-- EAN ou o motivo de não ter EAN).
--
-- Duas fontes alimentam esses campos:
--   1. a página de detalhe da TrazPraCa (/produtos-marketplace/id/<num>) —
--      descrição, características, categoria e fotos em alta;
--   2. a planilha "Informações de Produtos - Trazpraca.Club_R01P_PREENCHIDO"
--      — EAN, fabricante, NCM, referência e dimensões conferidas.
--
-- A ponte entre as duas é `cloudfront_id`: o número que aparece no caminho da
-- foto (…/Products/12/89/128966_pote-porta-tempero…). A planilha usa o código
-- interno da TrazPraCa e a vitrine usa outro id — só a foto liga os dois.
-- Cobertura medida em 31/07/2026: 54 dos 66 produtos (82%).
--
-- Só adiciona coluna/tabela. Nada é apagado ou alterado. (db/COMO_MIGRAR.md)
-- ============================================================================

-- ---------------------------------------------------------------- ficha ----
alter table vendas_produtos add column if not exists cloudfront_id text;
alter table vendas_produtos add column if not exists categoria_trazpraca text;
alter table vendas_produtos add column if not exists descricao text;
alter table vendas_produtos add column if not exists caracteristicas jsonb;   -- {"Material":"Vidro","Capacidade":"1,3L",…}
alter table vendas_produtos add column if not exists fotos jsonb;             -- ["https://…_z2.jpg", …] em alta resolução
alter table vendas_produtos add column if not exists estoque_qtd integer;     -- quantidade (só vem da planilha; a vitrine só diz sim/não)
alter table vendas_produtos add column if not exists prazo_envio text;        -- "D+0", "D+2"…

-- ------------------------------------------------------------ logística ----
alter table vendas_produtos add column if not exists peso_kg numeric(10,3);
alter table vendas_produtos add column if not exists altura_cm numeric(10,2);
alter table vendas_produtos add column if not exists largura_cm numeric(10,2);
alter table vendas_produtos add column if not exists profundidade_cm numeric(10,2);

-- ------------------------------------------- atributos exigidos pelo ML ----
alter table vendas_produtos add column if not exists ean text;
alter table vendas_produtos add column if not exists marca text;
alter table vendas_produtos add column if not exists modelo text;             -- palavra-chave de atração, não modelo técnico
alter table vendas_produtos add column if not exists ncm text;
alter table vendas_produtos add column if not exists referencia_fornecedor text;

-- ------------------------------------------------- rascunho do anúncio ----
alter table vendas_produtos add column if not exists ml_categoria_id text;    -- ex: "MLB193627"
alter table vendas_produtos add column if not exists ml_categoria_nome text;  -- ex: "Porta Condimentos"
alter table vendas_produtos add column if not exists titulo_anuncio text;     -- até 60 caracteres (limite do ML)
alter table vendas_produtos add column if not exists descricao_anuncio text;  -- descrição reescrita para venda

-- ------------------------------------------- inteligência de mercado ML ----
-- Vem da planilha: o que anúncios semelhantes praticam hoje.
alter table vendas_produtos add column if not exists ml_ref_vendas integer;
alter table vendas_produtos add column if not exists ml_ref_preco_min numeric(12,2);
alter table vendas_produtos add column if not exists ml_ref_preco_max numeric(12,2);

-- ------------------------------------------------------------ controle ----
alter table vendas_produtos add column if not exists enriquecido_em timestamptz;
alter table vendas_produtos add column if not exists fonte_enriquecimento text;  -- 'detalhe', 'detalhe+planilha'
alter table vendas_produtos add column if not exists pronto_para_publicar boolean not null default false;
alter table vendas_produtos add column if not exists pendencias jsonb;           -- ["sem EAN","sem foto ≥500px"]

-- ---------------------------------------------- política de preço da loja ----
-- Regra da Adriana (31/07/2026): mirar 30% de margem; quando o concorrente
-- estiver mais barato, ACOMPANHAR o concorrente até 15% — e nunca abaixo.
-- Se nem 15% couber no preço do concorrente, o portal não persegue: para no
-- piso e marca o produto como fora de competição.
alter table vendas_config add column if not exists margem_minima_pct numeric(6,2) not null default 15;

-- Marca usada quando a planilha não tem fabricante para o produto.
-- Decisão da Adriana (31/07/2026): "PRÓPRIA". Fica em config e não no código
-- porque é o tipo de coisa que muda sem aviso — e trocar aqui vale para todos
-- os anúncios futuros de uma vez.
alter table vendas_config add column if not exists marca_padrao text not null default 'PRÓPRIA';

-- Teto de variação que o reajuste automático pode aplicar sozinho numa rodada.
-- Acima disso vira alerta em vez de ação — protege contra erro de leitura da
-- TrazPraCa virar preço absurdo no ar (foi assim que a cadeira foi a R$ 1,18).
alter table vendas_config add column if not exists reajuste_max_pct numeric(6,2) not null default 25;

-- Preço decidido pelo portal e por que ele é esse.
alter table vendas_produtos add column if not exists preco_recomendado numeric(12,2);
alter table vendas_produtos add column if not exists preco_motivo text
  check (preco_motivo is null or preco_motivo in ('alvo','mercado','piso'));
alter table vendas_produtos add column if not exists fora_de_competicao boolean not null default false;

create index if not exists idx_vendas_produtos_cloudfront on vendas_produtos(cloudfront_id);
create index if not exists idx_vendas_produtos_pronto on vendas_produtos(pronto_para_publicar);

-- Novos tipos de sincronização usados pelo enriquecedor e pelo publicador.
-- (O check original de vendas_sync_log só previa scan/preço/saldo/validador.)
alter table vendas_sync_log drop constraint if exists vendas_sync_log_tipo_check;
alter table vendas_sync_log add constraint vendas_sync_log_tipo_check
  check (tipo in ('scan_novos','preco_ml','preco_shopee','saldo_trazpraca',
                  'validador_preco','enriquecimento','carga_catalogo',
                  'publicacao_ml','publicacao_shopee','estoque'));

-- Novos tipos de alerta (estoque e falha de enriquecimento).
alter table vendas_alertas drop constraint if exists vendas_alertas_tipo_check;
alter table vendas_alertas add constraint vendas_alertas_tipo_check
  check (tipo in ('preco_anomalo','estoque_zerado','saldo_trazpraca_baixo',
                  'sync_falhou','custo_subiu','custo_caiu','ficha_incompleta',
                  'publicacao_falhou'));

notify pgrst, 'reload schema';
