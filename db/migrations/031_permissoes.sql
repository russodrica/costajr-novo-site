-- ============================================================================
-- 031 — Central de Permissões por perfil
-- O admin define quais ÁREAS do portal e quais CATEGORIAS da base de
-- conhecimento cada perfil acessa (matriz editável em /admin/permissoes).
-- ============================================================================

create table if not exists portal_permissoes (
  perfil text primary key,
  areas text[] not null default '{}',
  categorias_kb text[] not null default '{}',
  updated_at timestamptz not null default now()
);
alter table portal_permissoes enable row level security;

-- Defaults (espelham a matriz do portal antigo/Manus)
insert into portal_permissoes (perfil, areas, categorias_kb) values
  ('admin',       '{onboarding,treinamentos,forum,documentos,comercial,gestao,meus-equipamentos}', '{Geral,Administrativo,Financeiro,Trabalhista,"Segurança do Trabalho",RH,Recrutamento,Comercial,Operacional}'),
  ('coordenador', '{onboarding,treinamentos,forum,documentos,comercial,gestao,meus-equipamentos}', '{Geral,Administrativo,Financeiro,Trabalhista,"Segurança do Trabalho",RH,Recrutamento,Comercial,Operacional}'),
  ('financeiro',  '{onboarding,treinamentos,forum,documentos,meus-equipamentos}',                  '{Geral,Administrativo,Financeiro,"Segurança do Trabalho",Comercial,Operacional}'),
  ('comercial',   '{onboarding,treinamentos,forum,documentos,comercial,meus-equipamentos}',        '{Geral,Comercial}'),
  ('rh',          '{onboarding,treinamentos,forum,documentos,meus-equipamentos}',                  '{Geral,Administrativo,Trabalhista,RH,Recrutamento,"Segurança do Trabalho"}'),
  ('operacional', '{onboarding,treinamentos,forum,documentos,gestao,meus-equipamentos}',           '{Geral,"Segurança do Trabalho",Operacional}')
on conflict (perfil) do nothing;
