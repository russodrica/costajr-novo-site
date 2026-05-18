-- Migration 015: Visitas extras e emergenciais inclusas por plano
-- Trimestral: 1 visita extra + 1 emergencial inclusos
-- Semestral: 6 visitas extras (1/mes) + 2 emergenciais inclusos
-- Anual: 12 visitas extras (1/mes) + 4 emergenciais inclusos
-- Data: 2026-05-14

-- 1) Configuracao do plano (referencia para o admin / parametrizacao)
alter table manut_planos add column if not exists visitas_extras_inclusas integer not null default 0;
alter table manut_planos add column if not exists emergenciais_inclusos integer not null default 0;

-- 2) Snapshot por cliente: total contratado (referencia) e saldo disponivel (consumido)
alter table manut_clientes add column if not exists extras_contratados integer not null default 0;
alter table manut_clientes add column if not exists emergenciais_contratados integer not null default 0;
alter table manut_clientes add column if not exists extras_disponiveis integer not null default 0;
alter table manut_clientes add column if not exists emergenciais_disponiveis integer not null default 0;

-- 3) Flag no proprio chamado: marca se foi consumido do saldo incluso (nao gera cobranca)
alter table manut_chamados add column if not exists incluso_no_plano boolean not null default false;
