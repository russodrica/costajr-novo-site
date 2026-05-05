-- ============================================================================
-- COSTA JÚNIOR — Schema PostgreSQL (Supabase)
-- ============================================================================
-- Substitui as 22+ coleções do Wix CMS por tabelas relacionais.
-- Tudo em snake_case (convenção PostgreSQL).
-- IDs: text UUID gerado por Supabase (gen_random_uuid()::text)
-- Timestamps: timestamptz com default now()
-- ============================================================================

-- ─── Extensões ──────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- ============================================================================
-- PORTAL CJR — Membros internos, base de conhecimento, mural, chat
-- ============================================================================

create table if not exists portal_profiles (
  id text primary key default gen_random_uuid()::text,
  member_id text unique,
  email text unique not null,
  display_name text,
  full_name text,
  role text not null default 'pendente' check (role in ('admin','coordenador','financeiro','comercial','rh','operacional','pendente')),
  approval_status text not null default 'pending' check (approval_status in ('pending','approved','rejected')),
  approved_by text,
  approved_at timestamptz,
  rejected_at timestamptz,
  rejection_reason text,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_portal_profiles_email on portal_profiles(email);
create index if not exists idx_portal_profiles_role on portal_profiles(role);
create index if not exists idx_portal_profiles_status on portal_profiles(approval_status);

create table if not exists portal_kb (
  id text primary key default gen_random_uuid()::text,
  question text not null,
  answer text not null,
  category text not null,
  access_roles text[] not null default '{all}',
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_portal_kb_category on portal_kb(category);

create table if not exists portal_pending_questions (
  id text primary key default gen_random_uuid()::text,
  user_id text,
  user_name text,
  question text not null,
  category text,
  status text not null default 'pending' check (status in ('pending','answered','ignored')),
  answer text,
  answered_by text,
  answered_at timestamptz,
  added_to_kb boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists portal_announcements (
  id text primary key default gen_random_uuid()::text,
  title text not null,
  content text not null,
  category text not null default 'comunicado',
  target_role text not null default 'all',
  created_by text,
  created_at timestamptz not null default now()
);

create table if not exists portal_conversations (
  id text primary key default gen_random_uuid()::text,
  user_id text not null,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists portal_messages (
  id text primary key default gen_random_uuid()::text,
  conversation_id text not null references portal_conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  was_answered boolean default false,
  category text,
  created_at timestamptz not null default now()
);
create index if not exists idx_portal_messages_conv on portal_messages(conversation_id, created_at);

create table if not exists portal_docs (
  id text primary key default gen_random_uuid()::text,
  title text not null,
  description text,
  category text,
  url text,
  storage_path text,
  access_roles text[] not null default '{all}',
  uploaded_by text,
  created_at timestamptz not null default now()
);

create table if not exists portal_audit_log (
  id text primary key default gen_random_uuid()::text,
  user_id text,
  user_name text,
  action text not null,
  target_type text,
  target_id text,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_audit_user on portal_audit_log(user_id, created_at desc);

create table if not exists portal_uniorgs (
  id text primary key default gen_random_uuid()::text,
  code text unique not null,
  name text not null,
  bank_data jsonb,
  metadata jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists idx_uniorgs_code on portal_uniorgs(code);

-- ============================================================================
-- MANUTENÇÃO — Clientes, lojas, técnicos, chamados, preventivas
-- ============================================================================

create table if not exists manut_planos (
  id text primary key default gen_random_uuid()::text,
  nome text not null,
  valor_mensal numeric(10,2) not null,
  numero_preventivas integer not null,
  chamados_inclusos integer,
  descricao text,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

-- Motor de precificação editavel pelo admin.
-- Preco final = preco_base do tipo_loja + (qtd_especialidades_extras * custo_especialidade)
create table if not exists manut_precificacao (
  tipo_loja text primary key check (tipo_loja in ('quiosque','ate40','41a80','81a120','121a250')),
  label text not null,
  descricao text,
  preco_base numeric(10,2) not null,
  custo_especialidade numeric(10,2) not null default 50,
  ordem integer not null default 0,
  ativo boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into manut_precificacao (tipo_loja, label, descricao, preco_base, ordem) values
  ('quiosque',  'Quiosque',      'Ponto compacto, baixa metragem',                            250, 1),
  ('ate40',     'Até 40 m²',     'Loja pequena de rua ou shopping',                           280, 2),
  ('41a80',     '41 a 80 m²',    'Loja média',                                                300, 3),
  ('81a120',    '81 a 120 m²',   'Loja grande',                                               400, 4),
  ('121a250',   '121 a 250 m²',  'Loja âncora ou centro de distribuição pequeno',             650, 5)
on conflict (tipo_loja) do nothing;

create table if not exists manut_clientes (
  id text primary key default gen_random_uuid()::text,
  email text unique not null,
  senha_hash text not null,
  nome text not null,
  codigo text unique not null,
  telefone text,
  cnpj_cpf text,
  status text not null default 'pendente' check (status in ('ativo','pendente','inadimplente','cancelado')),
  plano_id text references manut_planos(id),
  plano_selecionado text,
  valor_mensal_contratado numeric(10,2),
  visitas_contratadas integer,
  data_contratacao timestamptz,
  data_proximo_vencimento timestamptz,
  senha_troca_obrigatoria boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_manut_clientes_email on manut_clientes(email);
create index if not exists idx_manut_clientes_status on manut_clientes(status);

create table if not exists manut_lojas (
  id text primary key default gen_random_uuid()::text,
  cliente_id text not null references manut_clientes(id) on delete cascade,
  nome text not null,
  endereco text,
  cidade text,
  uf text,
  cep text,
  tamanho_m2 integer,
  especialidades jsonb,
  proxima_preventiva timestamptz,
  tecnico_vinculado_id text,
  status text not null default 'pendente' check (status in ('ativa','pendente','suspensa','cancelada')),
  created_at timestamptz not null default now()
);
create index if not exists idx_manut_lojas_cliente on manut_lojas(cliente_id);

create table if not exists manut_tecnicos (
  id text primary key default gen_random_uuid()::text,
  email text unique not null,
  senha_hash text not null,
  nome text not null,
  cpf text unique,
  telefone text,
  foto_url text,
  especialidades text[] not null default '{}',
  status text not null default 'ativo' check (status in ('ativo','inativo')),
  senha_troca_obrigatoria boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_manut_tecnicos_email on manut_tecnicos(email);

create table if not exists manut_chamados (
  id text primary key default gen_random_uuid()::text,
  loja_id text not null references manut_lojas(id),
  cliente_id text not null references manut_clientes(id),
  tipo text not null check (tipo in ('eletrica','hidraulica','civil')),
  descricao text not null,
  local_loja text,
  fotos_urls text[],
  tecnico_atribuido_id text references manut_tecnicos(id),
  status text not null default 'aberto' check (status in ('aberto','em_andamento','aguardando_material','concluido','cancelado')),
  prioridade text not null default 'normal' check (prioridade in ('baixa','normal','alta','urgente')),
  data_abertura timestamptz not null default now(),
  data_conclusao timestamptz,
  relatorio_final_url text,
  created_at timestamptz not null default now()
);
create index if not exists idx_manut_chamados_cliente on manut_chamados(cliente_id, status);
create index if not exists idx_manut_chamados_tecnico on manut_chamados(tecnico_atribuido_id);

create table if not exists manut_preventivas (
  id text primary key default gen_random_uuid()::text,
  loja_id text not null references manut_lojas(id),
  cliente_id text not null references manut_clientes(id),
  tecnico_atribuido_id text references manut_tecnicos(id),
  data_agendada timestamptz not null,
  data_executada timestamptz,
  status text not null default 'agendada' check (status in ('agendada','em_execucao','concluida','cancelada')),
  checklist jsonb,
  relatorio_url text,
  numero_visita integer,
  assinatura_tecnico_url text,
  created_at timestamptz not null default now()
);
create index if not exists idx_manut_preventivas_data on manut_preventivas(data_agendada);

create table if not exists manut_materiais (
  id text primary key default gen_random_uuid()::text,
  chamado_id text references manut_chamados(id),
  preventiva_id text references manut_preventivas(id),
  loja_id text not null references manut_lojas(id),
  cliente_id text not null references manut_clientes(id),
  tecnico_solicitante_id text references manut_tecnicos(id),
  descricao text not null,
  valor numeric(10,2) not null,
  status text not null default 'pendente_aprovacao' check (status in ('pendente_aprovacao','aprovado','aguardando_pagamento','pago','recusado')),
  comprovante_pagamento_url text,
  aprovado_em timestamptz,
  pago_em timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists manut_orcamentos (
  id text primary key default gen_random_uuid()::text,
  cliente_id text not null references manut_clientes(id),
  loja_id text references manut_lojas(id),
  descricao_solicitacao text not null,
  proposta_pdf_url text,
  valor numeric(10,2),
  status text not null default 'em_analise' check (status in ('em_analise','em_ajuste','aprovado','rejeitado')),
  comentario_cliente text,
  created_at timestamptz not null default now()
);

create table if not exists manut_pagamentos (
  id text primary key default gen_random_uuid()::text,
  cliente_id text not null references manut_clientes(id),
  valor numeric(10,2) not null,
  referencia text,
  status text not null default 'pendente' check (status in ('pendente','pago','atrasado','cancelado')),
  data_vencimento timestamptz,
  data_pagamento timestamptz,
  comprovante_url text,
  mercado_pago_id text,
  created_at timestamptz not null default now()
);

create table if not exists manut_suporte (
  id text primary key default gen_random_uuid()::text,
  usuario_tipo text not null check (usuario_tipo in ('cliente','tecnico')),
  usuario_id text not null,
  usuario_nome text,
  assunto text not null,
  descricao text not null,
  status text not null default 'aberto' check (status in ('aberto','em_atendimento','resolvido')),
  resposta_admin text,
  created_at timestamptz not null default now()
);

create table if not exists manut_sessoes (
  id text primary key default gen_random_uuid()::text,
  token text unique not null,
  tipo text not null check (tipo in ('cliente','tecnico')),
  usuario_id text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_manut_sessoes_token on manut_sessoes(token);
create index if not exists idx_manut_sessoes_expires on manut_sessoes(expires_at);

-- ============================================================================
-- BLOG / ARTIGOS (institucional)
-- ============================================================================

create table if not exists blog_posts (
  id text primary key default gen_random_uuid()::text,
  slug text unique not null,
  title text not null,
  excerpt text,
  content text not null,
  cover_image_url text,
  author text,
  tags text[] not null default '{}',
  published boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_blog_published on blog_posts(published, published_at desc);

-- ============================================================================
-- LEADS (formulário de contato)
-- ============================================================================

create table if not exists leads (
  id text primary key default gen_random_uuid()::text,
  nome text not null,
  email text not null,
  telefone text,
  empresa text,
  mensagem text,
  origem text not null default 'site' check (origem in ('site','manutencao','onboarding','indicacao')),
  status text not null default 'novo' check (status in ('novo','contatado','convertido','perdido')),
  metadata jsonb,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) — políticas básicas
-- ============================================================================

-- Por padrão, tudo bloqueado; backend usa service role pra queries.
-- (RLS detalhado pode ser adicionado depois conforme cada feature for testada.)

alter table portal_profiles enable row level security;
alter table manut_clientes enable row level security;
alter table manut_lojas enable row level security;
alter table manut_chamados enable row level security;
alter table manut_preventivas enable row level security;
alter table manut_materiais enable row level security;
alter table manut_orcamentos enable row level security;
alter table manut_pagamentos enable row level security;
alter table manut_tecnicos enable row level security;
alter table manut_sessoes enable row level security;
alter table manut_suporte enable row level security;
