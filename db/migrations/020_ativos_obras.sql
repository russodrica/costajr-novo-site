-- ============================================================================
-- 020 — Gestão de Ativos Patrimoniais + Obras/Projetos
-- Módulo novo: controle completo de bens da empresa (telefonia, informática,
-- equipamentos de obra, EPIs, veículos, mobiliário) com rastreabilidade total,
-- termo de responsabilidade com aceite digital e vínculo a colaboradores/obras.
-- Regras: histórico permanente e auditável; nenhuma movimentação é apagada.
-- ============================================================================

-- ─── Obras / Projetos ────────────────────────────────────────────────────────

create table if not exists obras (
  id text primary key default gen_random_uuid()::text,
  nome text not null,
  codigo text,
  cliente text,
  endereco text,
  cidade text,
  uf text,
  status text not null default 'ativa' check (status in ('planejada','ativa','pausada','concluida','cancelada')),
  data_inicio date,
  data_fim_prevista date,
  data_fim_real date,
  responsavel_nome text,
  valor_contrato numeric(14,2),
  observacoes text,
  criado_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_obras_status on obras(status);

-- ─── Ativos ──────────────────────────────────────────────────────────────────

create table if not exists ativos (
  id text primary key default gen_random_uuid()::text,
  codigo_interno text,
  numero_patrimonial text,
  categoria text not null check (categoria in ('telefonia','informatica','equipamento_obra','epi','veiculo','mobiliario','outros')),
  subcategoria text,
  descricao text not null,
  marca text,
  modelo text,
  fabricante text,
  numero_serie text,
  data_aquisicao date,
  valor_aquisicao numeric(12,2),
  fornecedor text,
  observacoes text,
  -- Documentação
  nota_fiscal_url text,
  numero_nota_fiscal text,
  data_nota_fiscal date,
  garantia boolean not null default false,
  garantia_fim date,
  manual_url text,
  fotos text[] not null default '{}',
  anexos jsonb not null default '[]',
  -- Campos específicos por categoria (imei1, imei2, linha, operadora, pin_puk,
  -- processador, ram, armazenamento, so, hostname, mac,
  -- placa, renavam, chassi, ano, km)
  campos jsonb not null default '{}',
  -- Situação atual
  status text not null default 'em_estoque' check (status in ('em_estoque','disponivel','alocado','em_manutencao','em_transito','extraviado','roubado','danificado','baixado','descartado')),
  alocado_para_tipo text check (alocado_para_tipo in ('colaborador','obra')),
  alocado_para_id text,
  alocado_para_nome text,
  criado_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_ativos_categoria on ativos(categoria);
create index if not exists idx_ativos_status on ativos(status);
create index if not exists idx_ativos_alocado on ativos(alocado_para_tipo, alocado_para_id);

-- ─── Movimentações (histórico imutável — nunca apagar) ──────────────────────

create table if not exists ativos_movimentos (
  id text primary key default gen_random_uuid()::text,
  ativo_id text not null references ativos(id),
  tipo text not null check (tipo in ('cadastro','entrega','transferencia','devolucao','envio_manutencao','retorno_manutencao','ocorrencia','mudanca_status','baixa','descarte','edicao')),
  descricao text not null,
  de_tipo text,
  de_id text,
  de_nome text,
  para_tipo text,
  para_id text,
  para_nome text,
  status_anterior text,
  status_novo text,
  condicao text,
  fotos text[] not null default '{}',
  dados jsonb not null default '{}',
  feito_por text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_ativos_mov_ativo on ativos_movimentos(ativo_id, created_at desc);

-- ─── Termos de responsabilidade ──────────────────────────────────────────────

create table if not exists ativos_termos (
  id text primary key default gen_random_uuid()::text,
  ativo_id text not null references ativos(id),
  movimento_id text references ativos_movimentos(id),
  colaborador_id text references portal_profiles(id),
  colaborador_nome text not null,
  colaborador_email text,
  conteudo text not null,
  condicao text,
  status text not null default 'pendente' check (status in ('pendente','aceito','cancelado')),
  aceito_em timestamptz,
  aceito_ip text,
  criado_por text,
  created_at timestamptz not null default now()
);
create index if not exists idx_ativos_termos_ativo on ativos_termos(ativo_id);
create index if not exists idx_ativos_termos_colab on ativos_termos(colaborador_id, status);

-- ─── Manutenções de ativos ───────────────────────────────────────────────────

create table if not exists ativos_manutencoes (
  id text primary key default gen_random_uuid()::text,
  ativo_id text not null references ativos(id),
  data_envio date not null,
  prestador text,
  motivo text,
  valor numeric(12,2),
  data_retorno date,
  garantia_servico text,
  status text not null default 'em_andamento' check (status in ('em_andamento','concluida','cancelada')),
  criado_por text,
  created_at timestamptz not null default now()
);
create index if not exists idx_ativos_manut_ativo on ativos_manutencoes(ativo_id);

-- ─── Ocorrências (extravio, roubo, dano...) ─────────────────────────────────

create table if not exists ativos_ocorrencias (
  id text primary key default gen_random_uuid()::text,
  ativo_id text not null references ativos(id),
  tipo text not null check (tipo in ('extravio','roubo','furto','dano','quebra','sinistro','outro')),
  data_ocorrencia date not null,
  descricao text not null,
  responsavel text,
  boletim_ocorrencia_url text,
  anexos text[] not null default '{}',
  criado_por text,
  created_at timestamptz not null default now()
);
create index if not exists idx_ativos_ocorr_ativo on ativos_ocorrencias(ativo_id);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

alter table obras enable row level security;
alter table ativos enable row level security;
alter table ativos_movimentos enable row level security;
alter table ativos_termos enable row level security;
alter table ativos_manutencoes enable row level security;
alter table ativos_ocorrencias enable row level security;
