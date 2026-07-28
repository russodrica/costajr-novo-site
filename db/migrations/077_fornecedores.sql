-- 077_fornecedores.sql
-- Usuários FORNECEDORES (externos): novo role 'fornecedor' em portal_profiles.
-- Acesso deny-by-default hard-coded no código (src/lib/permissoes.ts): SOMENTE
-- Documentos da Empresa (view empresa) e Extratos Bancários, nível "ver"
-- (visualizar + baixar; nunca inserir/editar/excluir). Fica FORA da lista do
-- requireAdmin (APIs /api/portal/* rejeitam) e fora dos PERFIS internos
-- (não aparece em matriz de permissões, membros, público-alvo etc.).
-- Coluna `empresa` = nome da empresa fornecedora (exibição/gestão).

alter table portal_profiles drop constraint if exists portal_profiles_role_check;
alter table portal_profiles add constraint portal_profiles_role_check
  check (role in ('admin','manutencao_operacao','manutencao_administrativo','operacional','rh','financeiro','comercial','juridico','coordenador','pendente','fornecedor'));

alter table portal_profiles add column if not exists empresa text;

notify pgrst, 'reload schema';
