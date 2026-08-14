-- 096_obras_fundacao.sql
--
-- O Relatório de Visita passa a atender DUAS ÁREAS da empresa:
--
--   * OBRAS      — usa o cadastro `obras` que já existe (249 obras hoje);
--   * FUNDAÇÃO   — tem carteira própria, que não aparece em Obras e Projetos,
--                  e por isso ganha cadastro separado nesta migration.
--
-- Quem cria o relatório escolhe primeiro a área. A partir daí a lista de obras
-- vem do cadastro certo, e dá para cadastrar uma obra de fundação na hora, sem
-- sair do relatório.
--
-- Por que tabela separada, e não uma coluna "area" na `obras`: as 249 obras de
-- hoje alimentam financeiro, ativos, tarefas e anotações. Misturar a carteira
-- de fundação ali dentro contaminaria todas essas telas de uma vez.

create table if not exists obras_fundacao (
  id text primary key default gen_random_uuid()::text,
  nome text not null,
  codigo text,
  cliente text,
  endereco text,
  cidade text,
  uf text,
  status text not null default 'ativa'
    check (status in ('planejada','ativa','pausada','concluida','cancelada')),
  data_inicio date,
  data_fim_prevista date,
  data_fim_real date,
  responsavel_nome text,
  observacoes text,
  criado_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_obras_fundacao_status on obras_fundacao(status);
create index if not exists idx_obras_fundacao_nome on obras_fundacao(nome);

comment on table obras_fundacao is
  'Carteira da área de Fundação. Não se mistura com `obras` (Obras e Projetos): serve ao Relatório de Visita da área de fundação.';

-- ─── o relatório passa a apontar para uma das duas carteiras ────────────────
alter table obras_rdo add column if not exists area        text not null default 'obras';
alter table obras_rdo add column if not exists fundacao_id text references obras_fundacao(id) on delete cascade;

-- `obra_id` era obrigatório: relatório de fundação não tem obra em `obras`.
alter table obras_rdo alter column obra_id drop not null;

do $$ begin
  alter table obras_rdo add constraint obras_rdo_area_ck
    check (area in ('obras', 'fundacao'));
exception when duplicate_object then null; end $$;

-- exatamente uma das duas pontas preenchida, conforme a área
do $$ begin
  alter table obras_rdo add constraint obras_rdo_vinculo_ck
    check (
      (area = 'obras'    and obra_id is not null and fundacao_id is null) or
      (area = 'fundacao' and fundacao_id is not null and obra_id is null)
    );
exception when duplicate_object then null; end $$;

-- um relatório por obra de fundação por dia (o mesmo que já valia para obras)
create unique index if not exists idx_obras_rdo_fundacao_data
  on obras_rdo(fundacao_id, data) where fundacao_id is not null;
create index if not exists idx_obras_rdo_area on obras_rdo(area, data desc);

comment on column obras_rdo.area is
  'obras | fundacao — define de qual cadastro vem a obra do relatório.';

-- ─── permissão do módulo novo ───────────────────────────────────────────────
-- Quem já tinha permissão explícita em Obras recebe a mesma na carteira de
-- fundação: é a mesma equipe, e sem isso a tela recém-criada nasce invisível
-- para quem já trabalhava com obras.
insert into portal_perm_usuario (profile_id, modulo, nivel)
select p.profile_id, 'obras-fundacao', p.nivel
  from portal_perm_usuario p
 where p.modulo = 'obras'
on conflict (profile_id, modulo) do nothing;
