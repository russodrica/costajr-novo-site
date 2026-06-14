-- ============================================================================
-- 041 — Programação de Férias (CLT)
--   Período aquisitivo (12 meses trabalhados = 30 dias de direito) +
--   parcelas (até 3, ex. 10/10/10). Verde quando soma = 30, vermelho se falta.
--   Lembretes: 6/3/1 mês do vencimento (limite concessivo) se não programado;
--   nag semanal se aberto; 30/15/7 dias antes de cada parcela; "dar OK" ao passar.
--   Ao confirmar 30 dias, período conclui e o próximo é liberado.
--   IDs em TEXT para casar com rh_colaboradores.id (convenção do projeto).
-- ============================================================================

create table if not exists rh_ferias_periodos (
  id text primary key default gen_random_uuid()::text,
  colaborador_id text not null references rh_colaboradores(id) on delete cascade,
  inicio_aquisitivo date not null,           -- início do período aquisitivo
  fim_aquisitivo date not null,              -- inicio + 12 meses - 1 dia
  limite_concessivo date not null,           -- "vencimento": prazo p/ tirar (fim_aquisitivo + 12 meses)
  dias_direito int not null default 30,
  status text not null default 'aberto',     -- aberto | programado | em_gozo | concluido | vencido
  observacoes text,
  aviso_6m boolean not null default false,
  aviso_3m boolean not null default false,
  aviso_1m boolean not null default false,
  nag_semana_em date,                        -- data do último alerta semanal de "falta programar"
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_ferias_periodos_colab on rh_ferias_periodos(colaborador_id);
create index if not exists idx_ferias_periodos_status on rh_ferias_periodos(status);

create table if not exists rh_ferias_parcelas (
  id text primary key default gen_random_uuid()::text,
  periodo_id text not null references rh_ferias_periodos(id) on delete cascade,
  colaborador_id text not null references rh_colaboradores(id) on delete cascade,
  data_inicio date not null,
  dias int not null,
  data_fim date not null,                    -- data_inicio + dias - 1
  status text not null default 'programada', -- programada | confirmada
  confirmada_em timestamptz,
  confirmada_por text,
  aviso_30 boolean not null default false,
  aviso_15 boolean not null default false,
  aviso_7 boolean not null default false,
  aviso_pos boolean not null default false,  -- e-mail de "dar OK" já enviado
  created_at timestamptz not null default now()
);
create index if not exists idx_ferias_parcelas_periodo on rh_ferias_parcelas(periodo_id);
create index if not exists idx_ferias_parcelas_colab on rh_ferias_parcelas(colaborador_id);

alter table rh_ferias_periodos enable row level security;
alter table rh_ferias_parcelas enable row level security;
