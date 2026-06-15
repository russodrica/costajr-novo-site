-- ============================================================================
-- 063 — Acessos a sistemas/programas por colaborador
-- Rastreia quais programas cada colaborador tem acesso (PortalCJR, Vobi, bancos,
-- pedágio, telefonia, etc.) para controle de troca de função e DESLIGAMENTO
-- (saber o que precisa ser revogado). Mantém HISTÓRICO: revogar não apaga,
-- só marca status='revogado' + revogado_em.
-- ============================================================================

create table if not exists rh_acessos (
  id text primary key default gen_random_uuid()::text,
  colaborador_id text not null references rh_colaboradores(id) on delete cascade,
  sistema text not null,                    -- nome do programa/sistema
  categoria text,                           -- agrupamento (Bancos, Telefonia, etc.)
  usuario text,                             -- login/usuário no sistema (opcional)
  observacao text,                          -- nota livre (perfil, nível de acesso, etc.)
  status text not null default 'ativo',     -- ativo | revogado
  concedido_em date,                        -- quando o acesso foi concedido
  revogado_em date,                         -- quando foi revogado (null = ativo)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (colaborador_id, sistema)          -- um registro por sistema por colaborador
);

create index if not exists idx_rh_acessos_colab on rh_acessos(colaborador_id);
create index if not exists idx_rh_acessos_status on rh_acessos(status);

alter table rh_acessos enable row level security;
