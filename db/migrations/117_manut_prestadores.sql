-- 117_manut_prestadores.sql
-- Marketplace de manutenção (pivô "intermediador de serviços") — FASE 1.
-- Cadastro de PRESTADORES externos + avaliação técnica por especialidade +
-- base para ranking/matching. Não destrutivo (só cria tabelas/índices).
-- IDs em TEXT (convenção do projeto). RLS ligado (deny-all; acesso só via
-- service role no backend, igual às demais tabelas).

create table if not exists manut_prestadores (
  id text primary key default gen_random_uuid()::text,
  nome text not null,
  email text not null unique,
  telefone text,
  tipo_pessoa text not null default 'pf',                 -- pf | pj (MEI/empresa)
  cpf_cnpj text,
  cidade text,
  uf text,
  bairro text,
  cep text,
  -- mobilidade / atendimento
  tem_veiculo boolean not null default false,
  raio_km integer not null default 10,
  atende_urgencia boolean not null default false,          -- consegue se deslocar rápido
  atende_fora_comercial boolean not null default false,    -- atende fora do horário comercial
  horarios jsonb not null default '{}'::jsonb,             -- disponibilidade por dia/turno
  tipos_cliente text[] not null default '{}',              -- residencia | condominio | comercial
  bio text,
  -- conta
  senha_hash text,
  senha_troca_obrigatoria boolean not null default false,
  -- ciclo de vida
  status text not null default 'cadastro'
    check (status in ('cadastro','avaliacao','aprovado','reprovado','inativo')),
  nota_geral integer,                                      -- média das especialidades aprovadas (0-100)
  observacao_admin text,
  aprovado_em timestamptz,
  aprovado_por text,
  last_login_at timestamptz,
  criado_em timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists manut_prestador_especialidades (
  id text primary key default gen_random_uuid()::text,
  prestador_id text not null references manut_prestadores(id) on delete cascade,
  especialidade text not null,                             -- eletrica, hidraulica, ...
  nota integer,                                            -- 0-100 (última avaliação)
  nivel text,                                              -- intermediario | avancado | reprovado | nao_avaliado
  aprovado boolean not null default false,                 -- passou do corte (>=70)
  avaliado_em timestamptz,
  unique (prestador_id, especialidade)
);

create table if not exists manut_prestador_avaliacoes (
  id text primary key default gen_random_uuid()::text,
  prestador_id text not null references manut_prestadores(id) on delete cascade,
  especialidade text not null,
  nota integer not null,                                   -- 0-100
  aprovado boolean not null default false,
  total_perguntas integer not null,
  acertos integer not null,
  respostas jsonb,                                         -- registro da tentativa
  criado_em timestamptz not null default now()
);

create index if not exists idx_prest_esp_prestador on manut_prestador_especialidades(prestador_id);
create index if not exists idx_prest_aval_prestador on manut_prestador_avaliacoes(prestador_id);
create index if not exists idx_prest_status on manut_prestadores(status);

alter table manut_prestadores enable row level security;
alter table manut_prestador_especialidades enable row level security;
alter table manut_prestador_avaliacoes enable row level security;
