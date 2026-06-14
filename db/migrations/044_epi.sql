-- ============================================================================
-- 044 — Ficha de EPI (gerada no sistema)
--   epi_entregas: estado ATUAL de cada EPI por colaborador (1 linha por
--     colaborador+epi) — base p/ a ficha sempre completa e p/ os alertas.
--   epi_fichas:   cada documento gerado (snapshot p/ impressao + assinado).
--   IDs em TEXT (convencao do projeto). RLS ligado (service role).
-- ============================================================================

create table if not exists epi_entregas (
  id text primary key default gen_random_uuid()::text,
  colaborador_id text not null references rh_colaboradores(id) on delete cascade,
  epi text not null,                       -- nome do EPI (do catalogo)
  ca text,                                 -- numero do CA
  tamanho text,
  data_entrega date,
  data_validade date,
  data_devolucao date,
  status text not null default 'ativo',    -- ativo | devolvido
  aviso_15 boolean not null default false, -- alerta de 15 dias ja enviado
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (colaborador_id, epi)
);
create index if not exists idx_epi_entregas_colab on epi_entregas(colaborador_id);
create index if not exists idx_epi_entregas_validade on epi_entregas(data_validade);

create table if not exists epi_fichas (
  id text primary key default gen_random_uuid()::text,
  colaborador_id text not null references rh_colaboradores(id) on delete cascade,
  tipo text not null default 'completa',   -- completa | reposicao
  data_geracao date not null,
  itens jsonb not null,                    -- snapshot dos itens impressos
  status text not null default 'gerada',   -- gerada | assinada
  assinado_path text,                      -- scan assinado (bucket privado rh)
  observacoes text,
  criado_por text,
  created_at timestamptz not null default now()
);
create index if not exists idx_epi_fichas_colab on epi_fichas(colaborador_id);

alter table epi_entregas enable row level security;
alter table epi_fichas enable row level security;
