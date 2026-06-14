-- 052_rh_cargos.sql
-- Cadastro de cargos (incluir/excluir) usado como TÍTULO da vaga no Recrutamento.
-- IDs em TEXT (padrão do projeto).
create table if not exists rh_cargos (
  id text primary key default gen_random_uuid()::text,
  nome text not null,
  area text,                         -- área sugerida (operacao|comercial|administrativo|financeiro|rh)
  ativo boolean not null default true,
  ordem int not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists rh_cargos_nome_uidx on rh_cargos (lower(nome));
alter table rh_cargos enable row level security;

-- Seed inicial (idempotente por nome)
insert into rh_cargos (nome, area, ordem) values
  ('Coordenador', null, 1),
  ('Gestor Operacional', 'operacao', 2),
  ('Gestor de Operação', 'operacao', 3),
  ('Arquiteto', 'operacao', 4),
  ('Engenheiro', 'operacao', 5),
  ('Coordenador de Manutenção', 'operacao', 6),
  ('Líder de Equipe', 'operacao', 7),
  ('Encarregado', 'operacao', 8),
  ('Oficial de Manutenção', 'operacao', 9),
  ('Meio Oficial', 'operacao', 10),
  ('Ajudante', 'operacao', 11),
  ('Administrativo', 'administrativo', 12),
  ('Assistente Administrativo', 'administrativo', 13),
  ('Financeiro', 'financeiro', 14),
  ('Assistente Financeiro', 'financeiro', 15),
  ('Comercial', 'comercial', 16),
  ('Assistente Comercial', 'comercial', 17)
on conflict (lower(nome)) do nothing;

notify pgrst, 'reload schema';
