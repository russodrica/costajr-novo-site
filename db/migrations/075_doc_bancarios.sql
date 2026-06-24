-- Documentos Bancários (área sensível dentro de Jurídico & Documentos).
-- Além dos extratos (074), guarda faturas de cartão (Ano→Mês) e empréstimos/financiamentos.
-- Arquivos no bucket PRIVADO `doc-empresa`.

-- Faturas de cartão de crédito — organizadas por Ano → Mês → cartão.
create table if not exists doc_cartao_faturas (
  id text primary key default gen_random_uuid()::text,
  ano int not null,
  mes int not null check (mes between 1 and 12),
  cartao text not null,
  valor numeric,
  vencimento date,
  storage_path text not null,
  nome_arquivo text,
  observacao text,
  criado_por text,
  created_at timestamptz not null default now()
);
create index if not exists idx_cartao_ano_mes on doc_cartao_faturas (ano, mes);
alter table doc_cartao_faturas enable row level security;

-- Empréstimos / Financiamentos — registro do contrato + condições.
create table if not exists doc_emprestimos (
  id text primary key default gen_random_uuid()::text,
  tipo text not null default 'emprestimo',          -- emprestimo | financiamento
  banco text,
  descricao text not null,
  valor_total numeric,
  num_parcelas int,
  valor_parcela numeric,
  data_contratacao date,
  data_primeira_parcela date,
  status text not null default 'ativo',             -- ativo | quitado | renegociado
  storage_path text,
  nome_arquivo text,
  observacao text,
  criado_por text,
  created_at timestamptz not null default now()
);
alter table doc_emprestimos enable row level security;
notify pgrst, 'reload schema';
