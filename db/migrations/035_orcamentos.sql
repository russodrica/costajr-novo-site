-- ============================================================================
-- 035 — Plataforma Inteligente de Orçamentos (Fase 1)
--   Base de serviços oficial + parâmetros de BDI + cadastros (Etapa 3) +
--   estrutura de orçamentos (usada na Fase 2 — montador de propostas).
--
--   MODELO DE PREÇO: os valores de custo_material/custo_mao_obra são CUSTO
--   DIRETO (sem BDI). O preço de venda = custo * (1 + BDI), onde o BDI é a soma
--   dos componentes (imposto, ISS, resultado, contingência, custo financeiro,
--   indireto, grau de risco) — aplicado por orçamento, não armazenado no serviço.
-- ============================================================================

-- ── Catálogo oficial de serviços (1.837 itens da base padronizada) ──────────
create table if not exists orc_servicos (
  codigo          text primary key,
  disciplina      text not null,                 -- Civil | Elétrica | Hidráulica | Ar Condicionado
  macrogrupo      text,
  grupo           text,                           -- subcategoria padronizada
  descricao       text not null,
  unidade         text,
  custo_material  numeric(14,4) not null default 0,
  custo_mao_obra  numeric(14,4) not null default 0,
  custo_total     numeric(14,4) generated always as (custo_material + custo_mao_obra) stored,
  fonte           text,
  status_auditoria text default 'OK',             -- OK | PREÇO DIVERGENTE | DUPLICADO EXATO | ...
  sinapi_codigo   text,                           -- Etapa 2 (preencher)
  sinapi_preco    numeric(14,4),
  sinapi_data     date,
  valor_referencia numeric(14,4),                 -- valor sugerido após confronto CJR x SINAPI
  observacoes     text,
  ativo           boolean not null default true,  -- false = aposentado (mantém histórico)
  data_atualizacao date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_orc_servicos_disc   on orc_servicos(disciplina, grupo);
create index if not exists idx_orc_servicos_status on orc_servicos(status_auditoria);
create index if not exists idx_orc_servicos_ativo  on orc_servicos(ativo);

-- ── Parâmetros de BDI / composição de custo (de COMPOSIÇÃO_CUSTO.xlsx) ───────
create table if not exists orc_parametros_bdi (
  chave       text primary key,
  rotulo      text not null,
  valor       numeric(8,5),                       -- fração: 0.25 = 25% (null p/ alçadas textuais)
  grupo       text,                               -- imposto | resultado | risco | financeiro | indireto | alcada
  observacao  text,
  ordem       integer default 0,
  updated_at  timestamptz not null default now()
);

insert into orc_parametros_bdi (chave, rotulo, valor, grupo, observacao, ordem) values
  ('imposto',            'Imposto (MA/MO)',                              0.25,  'imposto',    '',                                              1),
  ('iss',                'ISS',                                          0.05,  'imposto',    'Obras fora de São Paulo Capital',               2),
  ('resultado_ate10',    'Resultado — até R$ 10 mil',                    0.50,  'resultado',  '',                                              3),
  ('resultado_10a50',    'Resultado — R$ 10 a 50 mil',                   0.40,  'resultado',  '',                                              4),
  ('resultado_50a100',   'Resultado — R$ 50 a 100 mil',                  0.30,  'resultado',  '',                                              5),
  ('resultado_acima100', 'Resultado — acima de R$ 100 mil',              0.25,  'resultado',  '',                                              6),
  ('contingencia',       'Contingência',                                 0.03,  'financeiro', '',                                              7),
  ('custo_financeiro',   'Custo Financeiro',                             0.015, 'financeiro', 'Obras sem sinal',                               8),
  ('indireto',           'Indireto',                                     0.155, 'indireto',   'Considerando R$ 100.000 de despesa fixa',       9),
  ('risco_1',            'Grau de Risco 1 — Sem risco',                  0.00,  'risco',      '',                                             10),
  ('risco_2',            'Grau de Risco 2 — Complexidade técnica',       0.25,  'risco',      '',                                             11),
  ('risco_3',            'Grau de Risco 3 — Sem interesse / incertezas', 0.50,  'risco',      '',                                             12),
  ('alcada_comercial',   'Alçada de desconto — Equipe Comercial',        0.015, 'alcada',     '',                                             13),
  ('alcada_coordenacao', 'Alçada de desconto — Coordenação Comercial',   null,  'alcada',     'Até 5,00%',                                    14),
  ('alcada_direcao',     'Alçada de desconto — Direção',                 null,  'alcada',     'Acima de 5,00%',                               15)
on conflict (chave) do nothing;

-- ── Cadastros da Etapa 3 (estrutura pronta, preenchimento futuro) ───────────
create table if not exists orc_equipamentos (
  codigo               text primary key,
  descricao            text not null,
  custo_horario        numeric(14,2),
  produtividade        numeric(14,4),
  unidade_produtividade text,
  operador_incluso     boolean default false,
  consumo_combustivel  numeric(10,2),
  fonte                text,
  data_atualizacao     date,
  created_at           timestamptz not null default now()
);
create table if not exists orc_equipes (
  codigo            text primary key,
  composicao        text not null,
  producao_diaria   numeric(14,4),
  unidade_producao  text,
  custo_horario     numeric(14,2),
  encargos          numeric(8,5),
  fonte             text,
  data_atualizacao  date,
  created_at        timestamptz not null default now()
);
create table if not exists orc_insumos (
  codigo       text primary key,
  material     text not null,
  unidade      text,
  fornecedor   text,
  valor        numeric(14,4),
  data_cotacao date,
  observacoes  text,
  created_at   timestamptz not null default now()
);

-- ── Orçamentos (Fase 2: montador de propostas) ──────────────────────────────
create table if not exists orc_orcamentos (
  id            text primary key default gen_random_uuid()::text,
  numero        text unique,
  titulo        text,
  cliente       text,
  lead_id       text,                             -- vínculo opcional com manut_leads
  obra_id       text,                             -- vínculo opcional com obras
  escopo        text,
  status        text not null default 'rascunho'
                check (status in ('rascunho','em_revisao','aprovado','enviado','aceito','recusado','cancelado')),
  -- snapshot dos componentes de BDI escolhidos para este orçamento
  bdi_imposto          numeric(8,5) default 0,
  bdi_iss              numeric(8,5) default 0,
  bdi_resultado        numeric(8,5) default 0,
  bdi_contingencia     numeric(8,5) default 0,
  bdi_custo_financeiro numeric(8,5) default 0,
  bdi_indireto         numeric(8,5) default 0,
  bdi_grau_risco       numeric(8,5) default 0,
  desconto             numeric(8,5) default 0,
  data_inicio          date,
  prazo_dias           integer,
  condicoes_pagamento  text,
  validade_dias        integer default 15,
  valor_custo          numeric(16,2) default 0,   -- soma dos custos diretos
  valor_total          numeric(16,2) default 0,   -- com BDI e desconto
  criado_por           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists idx_orc_orcamentos_status on orc_orcamentos(status);
create index if not exists idx_orc_orcamentos_lead   on orc_orcamentos(lead_id);
create index if not exists idx_orc_orcamentos_obra   on orc_orcamentos(obra_id);

create table if not exists orc_orcamento_itens (
  id             text primary key default gen_random_uuid()::text,
  orcamento_id   text not null references orc_orcamentos(id) on delete cascade,
  servico_codigo text,                            -- referência ao catálogo (snapshot abaixo)
  disciplina     text,
  grupo          text,
  descricao      text not null,
  unidade        text,
  quantidade     numeric(14,4) not null default 0,
  custo_material numeric(14,4) not null default 0,
  custo_mao_obra numeric(14,4) not null default 0,
  ordem          integer default 0,
  created_at     timestamptz not null default now()
);
create index if not exists idx_orc_itens on orc_orcamento_itens(orcamento_id);

-- ── RLS: acesso só via service role (backend). Sem policies = anon bloqueado. ─
alter table orc_servicos        enable row level security;
alter table orc_parametros_bdi  enable row level security;
alter table orc_equipamentos    enable row level security;
alter table orc_equipes         enable row level security;
alter table orc_insumos         enable row level security;
alter table orc_orcamentos      enable row level security;
alter table orc_orcamento_itens enable row level security;
