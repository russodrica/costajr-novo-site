-- 061_perfis.sql  — Onda Perfis (14/06/2026, decisão da Adriana)
-- Remove o perfil "coordenador". Adiciona "manutencao_operacao",
-- "manutencao_administrativo" e "juridico". A chave "operacional" continua
-- existindo (só o RÓTULO passa a ser "Operação"), p/ não migrar dados.
-- RODADA em produção via Management API.

-- 1) Constraint do role aceita os 8 perfis (+ coordenador legado tolerado + pendente)
alter table portal_profiles drop constraint if exists portal_profiles_role_check;
alter table portal_profiles add constraint portal_profiles_role_check
  check (role in ('admin','manutencao_operacao','manutencao_administrativo','operacional','rh','financeiro','comercial','juridico','coordenador','pendente'));

-- 2) Remapeamento dos membros que tinham 'coordenador'
update portal_profiles set role='admin', roles=array['admin','financeiro','comercial','rh','operacional'] where id='0f5ce68a-79fc-485b-ab16-463fada987c8'; -- Costa JR (sócio diretor)
update portal_profiles set role='comercial', roles=array['comercial'] where id='5383fd57-dc46-4167-a067-e9bf8ce03295'; -- Adriana Teste (desligada)
update portal_profiles set role='rh', roles=array['rh'] where id='89195493-62c1-4f61-a3ea-3e07f1ef5637'; -- Samyria (Coord. Administrativo) -> RH/DP
update portal_profiles set role='manutencao_operacao', roles=array['manutencao_operacao','manutencao_administrativo'] where id='d37f96e4-143c-4cf8-9f1f-6b17fbb88c2e'; -- Renata (Gestor de Manutenção)
update portal_profiles set roles = array_remove(roles, 'coordenador') where 'coordenador' = any(roles); -- defensivo

-- 3) Matriz de permissões: remove coordenador + semeia os 3 perfis novos
delete from portal_permissoes where perfil in ('coordenador','manutencao_operacao','manutencao_administrativo','juridico');
insert into portal_permissoes (perfil, areas, categorias_kb) values
 ('manutencao_operacao', array['onboarding','treinamentos','forum','documentos','gestao','meus-equipamentos'], array['Geral','Segurança do Trabalho','Operacional']),
 ('manutencao_administrativo', array['onboarding','treinamentos','forum','documentos','gestao','meus-equipamentos'], array['Geral','Administrativo','Segurança do Trabalho','Operacional']),
 ('juridico', array['onboarding','treinamentos','forum','documentos','meus-equipamentos'], array['Geral','Trabalhista','Administrativo']);

notify pgrst, 'reload schema';
