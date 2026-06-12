-- ============================================================================
-- 029 — Migração da Gestão Comercial do Manus
-- Prospecção B2B: empresas não têm e-mail de lead; ganham tipo de cliente
-- (varejo/hospital/galpão/indústria/condomínio) e controle de interações
-- ("X dias sem contato" — diferencial do painel do Manus).
-- ============================================================================

alter table manut_leads alter column email drop not null;
alter table manut_leads add column if not exists tipo_cliente text;
alter table manut_leads add column if not exists manus_id text unique;
alter table manut_leads add column if not exists ultima_interacao_em timestamptz;
