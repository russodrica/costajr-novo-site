-- ============================================================================
-- 042 — Auditoria + Lixeira (recuperação de 30 dias)
--   audit_log: registra TODA inclusão/edição/exclusão por usuário (rastreio).
--   lixeira:   guarda a linha excluída por 30 dias para recuperação.
--   IDs em TEXT (convenção do projeto). RLS ligado (acesso só via service role).
-- ============================================================================

create table if not exists audit_log (
  id text primary key default gen_random_uuid()::text,
  ts timestamptz not null default now(),
  usuario_email text,
  usuario_role text,
  acao text not null,            -- criar | editar | excluir | restaurar
  entidade text not null,        -- nome lógico do recurso (ex.: rh_colaboradores, ativos, fin_lancamentos)
  registro_id text,              -- id do registro afetado
  descricao text,                -- texto legível (ex.: "Excluiu colaborador João Silva")
  dados jsonb,                   -- snapshot do registro no momento da ação
  ip text,
  created_at timestamptz not null default now()
);
create index if not exists idx_audit_ts on audit_log(ts desc);
create index if not exists idx_audit_entidade on audit_log(entidade);
create index if not exists idx_audit_usuario on audit_log(usuario_email);
create index if not exists idx_audit_acao on audit_log(acao);

create table if not exists lixeira (
  id text primary key default gen_random_uuid()::text,
  entidade text not null,        -- tabela de origem (ex.: rh_documentos)
  registro_id text not null,     -- id original do registro
  dados jsonb not null,          -- linha completa excluída (para restaurar)
  descricao text,
  excluido_por text,
  excluido_em timestamptz not null default now(),
  expira_em timestamptz not null default (now() + interval '30 days'),
  restaurado boolean not null default false,
  restaurado_em timestamptz,
  restaurado_por text
);
create index if not exists idx_lixeira_expira on lixeira(expira_em);
create index if not exists idx_lixeira_entidade on lixeira(entidade);
create index if not exists idx_lixeira_restaurado on lixeira(restaurado);

alter table audit_log enable row level security;
alter table lixeira enable row level security;
