-- ============================================================================
-- 027 — Aceite online de propostas comerciais
-- Cada proposta ganha um link público (token) onde o cliente aceita ou recusa.
-- ============================================================================

alter table com_propostas add column if not exists token text unique default gen_random_uuid()::text;
alter table com_propostas add column if not exists aceita_em timestamptz;
alter table com_propostas add column if not exists aceite_ip text;
alter table com_propostas add column if not exists aceite_nome text;
alter table com_propostas add column if not exists recusa_motivo text;

create index if not exists idx_com_propostas_token on com_propostas(token);

-- Régua de cobrança (melhoria #9): marca o último estágio de lembrete enviado
-- por pagamento (vence_em_breve | vence_hoje | atrasado) para nunca duplicar e-mail.
alter table manut_pagamentos add column if not exists regua_estagio text;
