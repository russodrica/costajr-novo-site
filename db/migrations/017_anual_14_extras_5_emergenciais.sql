-- Migration 017: Plano Anual passa a incluir 14 visitas extras e 5 emergenciais
-- (era 12 extras + 4 emergenciais)
-- Atualiza:
--   1) manut_planos: visitas_extras_inclusas=14 e emergenciais_inclusos=5 nos planos Anuais ativos
--   2) manut_clientes: clientes ativos com plano Anual recebem +2 extras e +1 emergencial
-- Data: 2026-05-18

-- 1) Atualizar configuracao do plano (admin / parametrizacao)
update manut_planos
   set visitas_extras_inclusas = 14,
       emergenciais_inclusos = 5
 where lower(nome) like '%anual%'
   and ativo = true
   and (visitas_extras_inclusas < 14 or emergenciais_inclusos < 5);

-- 2) Backfill: clientes que contrataram Anual antes da mudanca recebem a diferenca
--    Identifica anual por extras_contratados = 12 e emergenciais_contratados = 4
update manut_clientes
   set extras_contratados = 14,
       extras_disponiveis = extras_disponiveis + 2,
       emergenciais_contratados = 5,
       emergenciais_disponiveis = emergenciais_disponiveis + 1
 where extras_contratados = 12
   and emergenciais_contratados = 4
   and status in ('ativo','active','approved');
