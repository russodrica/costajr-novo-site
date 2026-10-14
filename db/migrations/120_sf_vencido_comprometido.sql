-- 120_sf_vencido_comprometido.sql
-- Situação Financeira: regra da Adriana (14/10/2026) — "devemos tratar apenas de coisas que estão VENCIDAS
-- (com cobrança ou sem cobrança), e não vencimentos futuros. Vencimento futuro separa como DESPESAS
-- COMPROMETIDAS, pois dependendo de como for a empresa talvez sejam despesas que deixem de acontecer."
--
-- A partir desta migration, em fin_sf_dividas:
--   valor               = SÓ O VENCIDO (já passou do vencimento e não foi pago) — é o que conta como dívida
--   valor_a_vencer      = parcelas futuras (despesa comprometida; fica FORA da dívida e da meta)
--   proximo_vencimento  = próxima parcela a vencer
--   cobranca            = 'com_cobranca' | 'sem_cobranca' | null (null = deriva da situação:
--                         protestada/intimada/execucao/ajuizada/citada/inscrita => com cobrança)
--   vobi_fornecedor_id  = fornecedor na Vobi (botão "Atualizar da Vobi" sincroniza vencido/a vencer)
--   comprometida_cortada / cortada_em = a Adriana marcou que a despesa comprometida NÃO vai acontecer
-- Padrão do projeto: enums validados na API (sem CHECK), RLS já ligado na tabela (migration 118).

alter table fin_sf_dividas add column if not exists valor_a_vencer numeric;
alter table fin_sf_dividas add column if not exists proximo_vencimento date;
alter table fin_sf_dividas add column if not exists cobranca text;
alter table fin_sf_dividas add column if not exists vobi_fornecedor_id integer;
alter table fin_sf_dividas add column if not exists comprometida_cortada boolean not null default false;
alter table fin_sf_dividas add column if not exists cortada_em date;

create index if not exists idx_fin_sf_dividas_vobi_forn on fin_sf_dividas(vobi_fornecedor_id) where vobi_fornecedor_id is not null;

notify pgrst, 'reload schema';
