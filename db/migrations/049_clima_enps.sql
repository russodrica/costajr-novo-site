-- ============================================================================
-- 049 — Pesquisa de Clima / eNPS (anônima, por período)
--   rh_clima_pesquisas: campanha (titulo, periodo, token público, ativa).
--   rh_clima_respostas: respostas ANÔNIMAS (sem colaborador_id por design).
--   eNPS 0-10 + dimensões 1-5 (jsonb) + comentário. IDs TEXT, RLS ligado.
-- ============================================================================

create table if not exists rh_clima_pesquisas (
  id text primary key default gen_random_uuid()::text,
  titulo text not null,
  periodo text,                            -- ex.: "2º trim. 2026"
  token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  ativa boolean not null default true,
  criado_por text,
  created_at timestamptz not null default now()
);
create index if not exists idx_clima_token on rh_clima_pesquisas(token);

create table if not exists rh_clima_respostas (
  id text primary key default gen_random_uuid()::text,
  pesquisa_id text not null references rh_clima_pesquisas(id) on delete cascade,
  enps int,                                -- 0..10
  respostas jsonb,                         -- { dimensao: nota(1-5) }
  comentario text,
  created_at timestamptz not null default now()
);
create index if not exists idx_clima_resp_pesquisa on rh_clima_respostas(pesquisa_id);

alter table rh_clima_pesquisas enable row level security;
alter table rh_clima_respostas enable row level security;
