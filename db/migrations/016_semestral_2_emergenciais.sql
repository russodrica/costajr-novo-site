-- Migration 016: Plano Semestral passa a incluir 2 emergenciais (era 1)
-- Atualiza:
--   1) manut_planos: emergenciais_inclusos = 2 nos planos Semestrais ativos
--   2) manut_clientes: clientes ativos com plano semestral ganham +1 no contratado e +1 no disponivel
-- Data: 2026-05-18

-- 1) Atualizar configuracao do plano (admin / parametrizacao)
update manut_planos
   set emergenciais_inclusos = 2
 where lower(nome) like '%semestr%'
   and ativo = true
   and emergenciais_inclusos < 2;

-- 2) Backfill: clientes que contrataram Semestral antes da mudanca tem direito ao +1
--    Identifica semestral por valor_mensal_contratado != 0 e extras_contratados = 6
--    (regra atual: semestral = 6 extras inclusos; trimestral = 1; anual = 12)
update manut_clientes
   set emergenciais_contratados = emergenciais_contratados + 1,
       emergenciais_disponiveis = emergenciais_disponiveis + 1
 where extras_contratados = 6
   and emergenciais_contratados = 1
   and status in ('ativo','active','approved');
