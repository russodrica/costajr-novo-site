-- 097_relatorio_visita_ajustes.sql
--
-- Ajustes pedidos depois do primeiro uso do Relatório de Visita:
--
--   * responsável pela visita vira um catálogo com nome padrão, em vez de
--     campo em branco a cada relatório;
--   * "Sem ocorrência" passa a ser uma opção do catálogo — a visita tranquila
--     também é informação, e o relatório precisa poder dizer isso;
--   * a área de Fundação não usa checklist.

-- ─── responsáveis pela visita ───────────────────────────────────────────────
create table if not exists obras_cat_responsaveis (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  padrao boolean not null default false,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

insert into obras_cat_responsaveis (nome, padrao) values
  ('Eng. José Ferreira da Costa Júnior', true)
on conflict (nome) do update set padrao = true, ativo = true;

alter table obras_cat_responsaveis enable row level security;

comment on table obras_cat_responsaveis is
  'Quem assina o Relatório de Visita. O nome marcado como padrão vem preenchido; nome novo digitado na tela entra sozinho aqui.';

-- ─── "Sem ocorrência" na frente da lista ────────────────────────────────────
-- O acento serve de âncora: a lista da tela ordena por nome, e o espaço à
-- frente não existiria em nome digitado por gente.
insert into obras_cat_ocorrencias (nome, cor) values
  ('Sem ocorrência', '#059669')
on conflict (nome) do update set ativo = true;

-- ─── checklist só na área de Obras ──────────────────────────────────────────
alter table obras_checklist_modelos add column if not exists area text not null default 'obras';

do $$ begin
  alter table obras_checklist_modelos add constraint obras_checklist_modelos_area_ck
    check (area in ('obras', 'fundacao', 'todas'));
exception when duplicate_object then null; end $$;
