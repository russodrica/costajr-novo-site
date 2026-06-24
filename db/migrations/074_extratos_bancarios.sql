-- Extratos bancários organizados por Ano → Mês → Banco (cofre da Documentação da Empresa).
-- Arquivos ficam no bucket PRIVADO `doc-empresa` (mesmo dos demais docs), sob extratos/.
create table if not exists doc_extratos_bancarios (
  id text primary key default gen_random_uuid()::text,
  ano int not null,
  mes int not null check (mes between 1 and 12),
  banco text not null,
  storage_path text not null,
  nome_arquivo text,
  observacao text,
  criado_por text,
  created_at timestamptz not null default now()
);
create index if not exists idx_extratos_ano_mes on doc_extratos_bancarios (ano, mes);
alter table doc_extratos_bancarios enable row level security;
notify pgrst, 'reload schema';
