-- ============================================================================
-- 083 — Vendas: qualidade e visibilidade do anúncio no Mercado Livre
--
-- Regra da casa, dita pela Adriana: "quanto mais coisas não ficam em branco,
-- melhor fica o anúncio e mais exposição". O ML concorda — a régua de
-- qualidade dele (`GET /items/{id}/health`) mede completude, e anúncio
-- incompleto aparece menos na busca e some dos filtros.
--
-- Estas colunas guardam o que o PRÓPRIO ML respondeu sobre cada anúncio, para
-- a tela poder mostrar, produto a produto, o que está faltando — em vez de
-- adivinhar por fora com uma régua caseira que envelhece.
--
-- Só adiciona coluna. Nada é apagado. (db/COMO_MIGRAR.md)
-- ============================================================================

-- Lista de ações que o ML devolve em /health: cada item é algo que, se
-- preenchido, sobe a nota. Ex.: ["complete_technical_specifications"].
alter table vendas_produtos add column if not exists ml_acoes_qualidade jsonb;

-- Quando o portal conferiu a qualidade deste anúncio pela última vez.
alter table vendas_produtos add column if not exists ml_visibilidade_em timestamptz;

-- Quantos campos o portal conseguiu preencher na última passada. Zero pode
-- significar duas coisas bem diferentes: "já estava completo" ou "o portal
-- não tinha ficha para preencher" — por isso a tela olha também o
-- enriquecido_em antes de dizer qual é o caso.
alter table vendas_produtos add column if not exists ml_campos_preenchidos integer;

create index if not exists idx_vendas_produtos_saude on vendas_produtos(ml_saude);

comment on column vendas_produtos.ml_acoes_qualidade is 'O que o Mercado Livre diz que falta neste anúncio (GET /items/{id}/health → actions).';
comment on column vendas_produtos.ml_campos_preenchidos is 'Campos preenchidos pelo portal na última rodada de visibilidade.';

notify pgrst, 'reload schema';
