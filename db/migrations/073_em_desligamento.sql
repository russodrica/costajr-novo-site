-- Status "EM DESLIGAMENTO" + tabela de tarefas do desligamento (TI cancela 1 a 1).
-- Ao entrar em em_desligamento: PortalCJR e Telegram são cortados automaticamente;
-- bancos/Vobi/Rotaexata/ControlID/demais plataformas viram tarefas para a TI.

alter table rh_colaboradores drop constraint if exists rh_colaboradores_status_check;
alter table rh_colaboradores add constraint rh_colaboradores_status_check
  check (status in ('ativo','ferias','afastado','congelado','em_desligamento','desligado'));

create table if not exists rh_desligamento_tarefas (
  id text primary key default gen_random_uuid()::text,
  colaborador_id text not null references rh_colaboradores(id) on delete cascade,
  colaborador_nome text,
  categoria text,
  sistema text not null,
  acao text not null default 'cancelar',           -- cancelar | trocar_senha | inativar | excluir | cancelar_trocar
  descricao text not null,
  link text,
  status text not null default 'pendente' check (status in ('pendente','concluida')),
  concluida_em timestamptz,
  concluida_por text,
  observacao text,
  criado_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_desl_tarefas_colab on rh_desligamento_tarefas (colaborador_id);
create index if not exists idx_desl_tarefas_status on rh_desligamento_tarefas (status);
alter table rh_desligamento_tarefas enable row level security;

notify pgrst, 'reload schema';
